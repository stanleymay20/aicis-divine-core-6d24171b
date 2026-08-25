import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { requireAdminOrCron } from "../_shared/auth.ts";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const CONNECTOR_KEY = "openmeteo_weather_telemetry";

interface WatchRegion {
  key: string;
  name: string;
  iso3: string;
  latitude: number;
  longitude: number;
}

const WATCH_REGIONS: WatchRegion[] = [
  { key: "berlin_deu", name: "Berlin", iso3: "DEU", latitude: 52.52, longitude: 13.405 },
  { key: "accra_gha", name: "Accra", iso3: "GHA", latitude: 5.6037, longitude: -0.187 },
  { key: "lagos_nga", name: "Lagos", iso3: "NGA", latitude: 6.5244, longitude: 3.3792 },
  { key: "nairobi_ken", name: "Nairobi", iso3: "KEN", latitude: -1.2921, longitude: 36.8219 },
  { key: "cairo_egy", name: "Cairo", iso3: "EGY", latitude: 30.0444, longitude: 31.2357 },
  { key: "istanbul_tur", name: "Istanbul", iso3: "TUR", latitude: 41.0082, longitude: 28.9784 },
  { key: "new_delhi_ind", name: "New Delhi", iso3: "IND", latitude: 28.6139, longitude: 77.209 },
  { key: "jakarta_idn", name: "Jakarta", iso3: "IDN", latitude: -6.2088, longitude: 106.8456 },
  { key: "tokyo_jpn", name: "Tokyo", iso3: "JPN", latitude: 35.6762, longitude: 139.6503 },
  { key: "new_york_usa", name: "New York", iso3: "USA", latitude: 40.7128, longitude: -74.006 },
  { key: "los_angeles_usa", name: "Los Angeles", iso3: "USA", latitude: 34.0522, longitude: -118.2437 },
  { key: "sao_paulo_bra", name: "São Paulo", iso3: "BRA", latitude: -23.5558, longitude: -46.6396 },
];

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    rain?: number;
    showers?: number;
    snowfall?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
  };
}

interface TelemetryRow {
  connector_key: string;
  observation_type: string;
  observed_entity: string;
  observed_region: string;
  observed_at: string;
  observation_value: number;
  observation_unit: string;
  confidence_score: null;
  anomaly_score: null;
  raw_payload: Record<string, unknown>;
}

interface ExistingObservation {
  observation_type: string;
  observed_region: string;
  observed_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function finiteOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function observationRows(region: WatchRegion, data: OpenMeteoResponse): TelemetryRow[] {
  const current = data.current;
  if (!current?.time) return [];
  const observedAtMs = Date.parse(current.time);
  if (!Number.isFinite(observedAtMs)) return [];
  const observedAt = new Date(observedAtMs).toISOString();
  const rows: TelemetryRow[] = [];

  const push = (type: string, rawValue: unknown, unit: string): void => {
    const value = finiteOrNull(rawValue);
    if (value === null) return;
    rows.push({
      connector_key: CONNECTOR_KEY,
      observation_type: type,
      observed_entity: region.name,
      observed_region: region.iso3,
      observed_at: observedAt,
      observation_value: value,
      observation_unit: unit,
      confidence_score: null,
      anomaly_score: null,
      raw_payload: {
        region_key: region.key,
        region_name: region.name,
        iso3: region.iso3,
        latitude: region.latitude,
        longitude: region.longitude,
        weather_code: finiteOrNull(current.weather_code),
        provider: "Open-Meteo",
        feed: "forecast/current",
        analytical_confidence: "not_assessed",
        analytical_anomaly: "not_assessed",
      },
    });
  };

  push("weather_temperature", current.temperature_2m, "celsius");
  push("weather_humidity", current.relative_humidity_2m, "percent");
  push("weather_precipitation", current.precipitation ?? current.rain, "mm");
  push("weather_rain", current.rain, "mm");
  push("weather_showers", current.showers, "mm");
  push("weather_snowfall", current.snowfall, "cm");
  push("weather_wind_speed", current.wind_speed_10m, "kmh");
  push("weather_wind_gust", current.wind_gusts_10m, "kmh");
  push("weather_code", current.weather_code, "wmo_code");
  return rows;
}

async function recordConnectorHealth(
  supabase: ReturnType<typeof createClient>,
  args: { success: boolean; inserted?: number; durationMs?: number; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabase
    .from("telemetry_connectors")
    .select("consecutive_failures")
    .eq("connector_key", CONNECTOR_KEY)
    .maybeSingle();
  if (lookupError) console.error("Open-Meteo connector lookup failed", lookupError.message);

  const row: Record<string, unknown> = {
    connector_key: CONNECTOR_KEY,
    connector_name: "Open-Meteo Weather Telemetry",
    connector_type: "weather",
    provider_name: "Open-Meteo",
    data_domain: "climate-disaster",
    geographic_scope: "selected-global-watch-regions",
    auth_mode: "none",
    polling_interval_seconds: 900,
    operational_status: args.success ? "active" : "degraded",
    consecutive_failures: args.success ? 0 : Number(existing?.consecutive_failures ?? 0) + 1,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      provider_url: "https://open-meteo.com/",
      watch_regions: WATCH_REGIONS.map((region) => region.key),
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
      analytical_scores: "not_assessed_at_ingestion",
    },
    updated_at: now,
  };
  if (args.success) row.last_success_at = now;
  else row.last_failure_at = now;

  const { error } = await supabase
    .from("telemetry_connectors")
    .upsert(row, { onConflict: "connector_key" });
  if (error) console.error("Open-Meteo connector health upsert failed", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const run = await startProviderRun(supabase, {
    provider_name: "openmeteo",
    endpoint: "ingest-openmeteo-weather-telemetry",
    scheduler_source: auth.via === "cron" ? "cron" : "admin",
  });

  try {
    const requestUrl = new URL(req.url);
    const regionParam = requestUrl.searchParams.get("region");
    const regions = regionParam
      ? WATCH_REGIONS.filter((region) => region.key === regionParam || region.iso3 === regionParam.toUpperCase())
      : WATCH_REGIONS;
    if (regionParam && regions.length === 0) return json({ error: "Unknown region" }, 400);

    const rows: TelemetryRow[] = [];
    for (const region of regions) {
      const apiUrl = new URL("https://api.open-meteo.com/v1/forecast");
      apiUrl.searchParams.set("latitude", String(region.latitude));
      apiUrl.searchParams.set("longitude", String(region.longitude));
      apiUrl.searchParams.set("current", [
        "temperature_2m",
        "relative_humidity_2m",
        "precipitation",
        "rain",
        "showers",
        "snowfall",
        "weather_code",
        "wind_speed_10m",
        "wind_gusts_10m",
      ].join(","));
      apiUrl.searchParams.set("forecast_days", "1");
      apiUrl.searchParams.set("timezone", "UTC");

      const response = await fetch(apiUrl, {
        headers: { "Accept": "application/json", "User-Agent": "AICIS/1.0 Open-Meteo telemetry" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Open-Meteo failed for ${region.key}: HTTP ${response.status}`);
      rows.push(...observationRows(region, await response.json() as OpenMeteoResponse));
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("telemetry_observations")
        .select("observation_type,observed_region,observed_at")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", new Date(Date.now() - 2 * 3_600_000).toISOString());
      if (existingError) throw existingError;

      const seen = new Set(
        ((existing ?? []) as ExistingObservation[])
          .map((row) => `${row.observation_type}|${row.observed_region}|${row.observed_at}`),
      );
      const freshRows = rows.filter((row) => !seen.has(`${row.observation_type}|${row.observed_region}|${row.observed_at}`));
      if (freshRows.length > 0) {
        const { error } = await supabase.from("telemetry_observations").insert(freshRows);
        if (error) throw error;
        inserted = freshRows.length;
      }
    }

    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, { success: true, inserted, durationMs });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-openmeteo-weather-telemetry",
      status: "success",
      message: `regions=${regions.length} observations=${rows.length} inserted=${inserted} duration_ms=${durationMs}`,
    });

    for (const rpcName of ["generate_telemetry_health_summary", "generate_strategic_digital_twins"]) {
      const { error } = await supabase.rpc(rpcName);
      if (error) console.warn(`${rpcName} refresh skipped`, error.message);
    }

    await finishProviderRun(supabase, run, {
      records_fetched: regions.length,
      records_inserted: inserted,
      records_normalized: rows.length,
    });
    return json({ status: "success", connector_key: CONNECTOR_KEY, regions: regions.length, observations: rows.length, inserted, duration_ms: durationMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, { success: false, durationMs, error: message });
    await supabase.from("automation_logs").insert({ job_name: "ingest-openmeteo-weather-telemetry", status: "error", message: message.slice(0, 500) });
    await failProviderRun(supabase, run, error);
    return json({ status: "error", error: message }, 500);
  }
});
