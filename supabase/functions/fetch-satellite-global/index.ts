import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-scheduler-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Observation = {
  iso_code: string;
  lat: number;
  lon: number;
  timestamp: string;
  source: "NASA_POWER";
  layer: "TEMPERATURE" | "SOLAR_IRRADIANCE" | "PRECIPITATION";
  value: number;
  confidence: number;
  metadata: Record<string, unknown>;
};

type PowerResponse = {
  properties?: {
    parameter?: {
      T2M?: Record<string, number>;
      ALLSKY_SFC_SW_DWN?: Record<string, number>;
      PRECTOTCORR?: Record<string, number>;
    };
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "nasa_power_global",
    endpoint: "fetch-satellite-global",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const rawBody: unknown = await req.json().catch(() => ({}));
    const body = isRecord(rawBody) ? rawBody : {};
    const requestedBatch = Number(body.batch_size ?? 24);
    const requestedOffset = Number(body.offset ?? 0);
    const batchSize = Math.min(Math.max(Number.isFinite(requestedBatch) ? requestedBatch : 24, 1), 75);
    const offset = Math.max(Number.isFinite(requestedOffset) ? Math.trunc(requestedOffset) : 0, 0);

    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 2);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const formatDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

    const { data: countryData, error: countryError } = await supabase
      .from("canonical_entities")
      .select("iso3,lat,lon")
      .eq("entity_type", "country")
      .not("iso3", "is", null)
      .not("lat", "is", null)
      .not("lon", "is", null)
      .order("iso3", { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (countryError) throw countryError;

    const observations: Observation[] = [];
    const providerErrors: string[] = [];

    for (const country of countryData ?? []) {
      const iso3 = typeof country.iso3 === "string" ? country.iso3 : "";
      const lat = Number(country.lat);
      const lon = Number(country.lon);
      if (!iso3 || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      try {
        const nasaUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,PRECTOTCORR,T2M&community=AG&longitude=${lon}&latitude=${lat}&start=${formatDate(start)}&end=${formatDate(end)}&format=JSON`;
        const response = await fetch(nasaUrl);
        if (!response.ok) throw new Error(`NASA POWER HTTP ${response.status}`);
        const data = await response.json() as PowerResponse;
        const parameters = data.properties?.parameter;
        const temperatureSeries = parameters?.T2M;
        if (!temperatureSeries) continue;

        const dates = Object.keys(temperatureSeries).sort();
        const lastDate = dates.at(-1);
        if (!lastDate || lastDate.length !== 8) continue;
        const observedAt = new Date(`${lastDate.slice(0, 4)}-${lastDate.slice(4, 6)}-${lastDate.slice(6, 8)}T00:00:00Z`).toISOString();
        const metadata = {
          evidence_class: "observed_remote_sensing_or_assimilated_measurement",
          provider: "NASA_POWER",
          window_start: formatDate(start),
          window_end: formatDate(end),
          batch_offset: offset,
        };

        pushObservation(observations, iso3, lat, lon, observedAt, "TEMPERATURE", temperatureSeries[lastDate], metadata);
        pushObservation(observations, iso3, lat, lon, observedAt, "SOLAR_IRRADIANCE", parameters?.ALLSKY_SFC_SW_DWN?.[lastDate], metadata);
        pushObservation(observations, iso3, lat, lon, observedAt, "PRECIPITATION", parameters?.PRECTOTCORR?.[lastDate], metadata);
      } catch (error) {
        providerErrors.push(`${iso3}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let inserted = 0;
    for (const observation of observations) {
      const { error } = await supabase.from("satellite_observations").insert(observation);
      if (error) providerErrors.push(`${observation.iso_code}/${observation.layer}: ${error.message}`);
      else inserted += 1;
    }

    await supabase.from("automation_logs").insert({
      job_name: "fetch-satellite-global",
      status: providerErrors.length === 0 ? "success" : inserted > 0 ? "partial" : "error",
      message: `NASA POWER observations=${observations.length}, inserted=${inserted}, errors=${providerErrors.length}, offset=${offset}, batch=${batchSize}`,
    });

    await finishProviderRun(supabase, run, {
      records_fetched: observations.length,
      records_inserted: inserted,
      records_normalized: inserted,
      error_count: providerErrors.length,
      error_summary: providerErrors.length > 0 ? providerErrors.join(" | ").slice(0, 2000) : null,
    });

    return json({
      ok: providerErrors.length === 0,
      fetched: observations.length,
      inserted,
      offset,
      batch_size: batchSize,
      errors: providerErrors.length,
      evidence_class: "NASA_POWER_observation",
    });
  } catch (error) {
    console.error("Error in fetch-satellite-global:", error);
    await failProviderRun(supabase, run, error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function pushObservation(
  observations: Observation[],
  iso3: string,
  lat: number,
  lon: number,
  timestamp: string,
  layer: Observation["layer"],
  rawValue: number | undefined,
  metadata: Record<string, unknown>,
) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value === -999) return;
  observations.push({
    iso_code: iso3,
    lat,
    lon,
    timestamp,
    source: "NASA_POWER",
    layer,
    value,
    confidence: 0.95,
    metadata,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
