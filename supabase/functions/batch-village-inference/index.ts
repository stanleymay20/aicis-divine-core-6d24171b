import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FN = "batch-village-inference";
const REGIONS_PER_BATCH = 50;
const NASA_TIMEOUT_MS = 10_000;

type SupabaseClientType = ReturnType<typeof createClient>;

type Region = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

type Indicator = {
  domain: "environment" | "health" | "infrastructure";
  indicator: string;
  value: number;
  unit: string;
  confidence: number;
  dataSource: "nasa_power" | "deterministic_derivation";
  model: string;
  observedAt: string;
  raw: Record<string, unknown>;
};

type Results = {
  processed: number;
  indicators: number;
  skipped_no_observation: number;
  errors: string[];
};

type NasaPowerResponse = {
  properties?: {
    parameter?: Record<string, Record<string, number>>;
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const results: Results = {
    processed: 0,
    indicators: 0,
    skipped_no_observation: 0,
    errors: [],
  };

  try {
    const { data: uncoveredData, error: rpcError } = await supabase
      .rpc("get_uncovered_regions", { _limit: REGIONS_PER_BATCH });
    if (rpcError) throw rpcError;

    const regions = normalizeRegions(uncoveredData);
    const { data: remainingData, error: remainingError } = await supabase.rpc("count_uncovered_regions");
    if (remainingError) throw remainingError;
    const totalRemaining = Math.max(0, Number(remainingData ?? 0));

    if (regions.length === 0) {
      await recordHeartbeat(supabase, true, null, {
        processed: 0,
        indicators: 0,
        remaining: 0,
        mode: "idle",
        evidence_policy: "observed_or_deterministically_derived_only",
      });
      return json({
        success: true,
        message: "No uncovered regions require refresh.",
        remaining: 0,
        evidence_policy: "observed_or_deterministically_derived_only",
      });
    }

    for (const region of regions) {
      try {
        const indicators = await generateIndicators(region);
        if (indicators.length === 0) {
          results.skipped_no_observation += 1;
          continue;
        }

        for (const indicator of indicators) {
          const { error } = await supabase.from("village_indicators").insert({
            region_id: region.id,
            domain: indicator.domain,
            indicator: indicator.indicator,
            value: indicator.value,
            unit: indicator.unit,
            confidence: indicator.confidence,
            data_source: indicator.dataSource,
            inference_model: indicator.model,
            observed_at: indicator.observedAt,
            raw: indicator.raw,
          });
          if (error) throw error;
          results.indicators += 1;
        }

        results.processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push(`${region.name}: ${message}`.slice(0, 500));
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const remaining = Math.max(0, totalRemaining - results.processed);
    const success = results.errors.length === 0 && (results.processed > 0 || remaining === 0);

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: success ? "success" : results.processed > 0 ? "partial" : "failed",
      message: `${results.processed}/${regions.length} regions observed, ${results.indicators} indicators appended. Remaining: ${remaining}. truth_floor=observed_only`,
    });

    await recordHeartbeat(
      supabase,
      success,
      results.errors.length > 0 ? results.errors.slice(0, 3).join(" | ") : null,
      {
        processed: results.processed,
        indicators: results.indicators,
        skipped_no_observation: results.skipped_no_observation,
        remaining,
        errors: results.errors.length,
        evidence_policy: "observed_or_deterministically_derived_only",
        synthetic_nightlight_proxy_disabled: true,
        historical_rows_preserved: true,
      },
    );

    const autoContinuing = remaining > 0 && await triggerNextBatch();

    return json({
      success,
      results,
      remaining,
      auto_continuing: autoContinuing,
      evidence_policy: "observed_or_deterministically_derived_only",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      level: "error",
      function: FN,
      message,
      timestamp: new Date().toISOString(),
    }));

    await recordHeartbeat(supabase, false, message, {
      evidence_policy: "observed_or_deterministically_derived_only",
    }).catch(() => undefined);

    return json({ error: message }, 500);
  }
});

function normalizeRegions(value: unknown): Region[] {
  if (!Array.isArray(value)) return [];

  const regions: Region[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name : id || "Unknown region";
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    regions.push({ id, name, lat, lon });
  }
  return regions;
}

async function generateIndicators(region: Region): Promise<Indicator[]> {
  const nasaData = await fetchNasaPower(region.lat, region.lon);
  if (!nasaData) return [];

  const indicators: Indicator[] = [];
  const observedAt = nasaData.observedAt;

  addObserved(indicators, "environment", "avg_temperature_c", nasaData.temperature, "°C", "T2M", observedAt, 0.95);
  addObserved(indicators, "environment", "daily_precipitation_mm", nasaData.precipitation, "mm/day", "PRECTOTCORR", observedAt, 0.95);
  addObserved(indicators, "environment", "solar_irradiance", nasaData.solar, "kWh/m²/day", "ALLSKY_SFC_SW_DWN", observedAt, 0.95);
  addObserved(indicators, "health", "relative_humidity_pct", nasaData.humidity, "%", "RH2M", observedAt, 0.95);
  addObserved(indicators, "environment", "wind_speed_2m", nasaData.wind, "m/s", "WS2M", observedAt, 0.95);

  if (nasaData.temperature !== null && nasaData.humidity !== null) {
    const heatStress = nasaData.temperature > 35 && nasaData.humidity > 60
      ? 9
      : nasaData.temperature > 30 && nasaData.humidity > 50
      ? 7
      : nasaData.temperature > 25
      ? 4
      : 2;

    indicators.push({
      domain: "health",
      indicator: "heat_stress_index",
      value: heatStress,
      unit: "1-10",
      confidence: 0.8,
      dataSource: "deterministic_derivation",
      model: "AICIS_HEAT_STRESS_RULE_V1",
      observedAt,
      raw: {
        evidence_class: "derived_from_observed_measurements",
        inputs: {
          avg_temperature_c: nasaData.temperature,
          relative_humidity_pct: nasaData.humidity,
        },
        provider: "NASA_POWER",
      },
    });
  }

  if (nasaData.solar !== null) {
    const score = nasaData.solar > 6 ? 9 : nasaData.solar > 4.5 ? 7 : nasaData.solar > 3 ? 5 : 3;
    indicators.push({
      domain: "infrastructure",
      indicator: "solar_energy_potential_score",
      value: score,
      unit: "1-10",
      confidence: 0.8,
      dataSource: "deterministic_derivation",
      model: "AICIS_SOLAR_POTENTIAL_RULE_V1",
      observedAt,
      raw: {
        evidence_class: "derived_from_observed_measurements",
        inputs: { solar_irradiance: nasaData.solar },
        provider: "NASA_POWER",
      },
    });
  }

  return indicators;
}

function addObserved(
  indicators: Indicator[],
  domain: Indicator["domain"],
  indicator: string,
  value: number | null,
  unit: string,
  nasaParameter: string,
  observedAt: string,
  confidence: number,
) {
  if (value === null) return;
  indicators.push({
    domain,
    indicator,
    value: Math.round(value * 10) / 10,
    unit,
    confidence,
    dataSource: "nasa_power",
    model: "NASA_POWER_API",
    observedAt,
    raw: {
      evidence_class: "observed_remote_sensing",
      provider: "NASA_POWER",
      nasa_parameter: nasaParameter,
    },
  });
}

async function fetchNasaPower(lat: number, lon: number): Promise<{
  observedAt: string;
  temperature: number | null;
  precipitation: number | null;
  solar: number | null;
  humidity: number | null;
  wind: number | null;
} | null> {
  const today = new Date();
  const endDate = new Date(today.getTime() - 7 * 86_400_000);
  const startDate = new Date(endDate.getTime() - 30 * 86_400_000);
  const formatDate = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");
  const parameters = "T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M";
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?start=${formatDate(startDate)}&end=${formatDate(endDate)}&latitude=${lat}&longitude=${lon}&community=AG&parameters=${parameters}&format=JSON`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NASA_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const payload = await response.json() as NasaPowerResponse;
    const parametersByName = payload.properties?.parameter ?? {};
    return {
      observedAt: endDate.toISOString(),
      temperature: average(parametersByName.T2M),
      precipitation: average(parametersByName.PRECTOTCORR),
      solar: average(parametersByName.ALLSKY_SFC_SW_DWN),
      humidity: average(parametersByName.RH2M),
      wind: average(parametersByName.WS2M),
    };
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      function: FN,
      message: "NASA POWER observation unavailable",
      error: error instanceof Error ? error.message : String(error),
      lat,
      lon,
      timestamp: new Date().toISOString(),
    }));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function average(series: Record<string, number> | undefined): number | null {
  if (!series) return null;
  const values = Object.values(series).filter((value) => Number.isFinite(value) && value !== -999);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function triggerNextBatch(): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!supabaseUrl || !publishableKey || !cronSecret) return false;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${FN}`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function recordHeartbeat(
  supabase: SupabaseClientType,
  success: boolean,
  error: string | null,
  metadata: Record<string, unknown>,
) {
  const { error: heartbeatError } = await supabase.rpc("register_pipeline_heartbeat", {
    _pipeline_name: FN,
    _success: success,
    _error: error,
    _metadata: metadata,
  });
  if (heartbeatError) {
    console.error(JSON.stringify({
      level: "error",
      function: FN,
      message: "pipeline heartbeat write failed",
      error: heartbeatError.message,
      timestamp: new Date().toISOString(),
    }));
  }
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
