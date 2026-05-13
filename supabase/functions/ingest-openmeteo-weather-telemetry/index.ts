import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CONNECTOR_KEY = "openmeteo_weather_telemetry";

type WatchRegion = {
  key: string;
  name: string;
  iso3: string;
  latitude: number;
  longitude: number;
};

const WATCH_REGIONS: WatchRegion[] = [
  { key: "berlin_deu", name: "Berlin", iso3: "DEU", latitude: 52.52, longitude: 13.405 },
  { key: "accra_gha", name: "Accra", iso3: "GHA", latitude: 5.6037, longitude: -0.1870 },
  { key: "lagos_nga", name: "Lagos", iso3: "NGA", latitude: 6.5244, longitude: 3.3792 },
  { key: "nairobi_ken", name: "Nairobi", iso3: "KEN", latitude: -1.2921, longitude: 36.8219 },
  { key: "cairo_egy", name: "Cairo", iso3: "EGY", latitude: 30.0444, longitude: 31.2357 },
  { key: "istanbul_tur", name: "Istanbul", iso3: "TUR", latitude: 41.0082, longitude: 28.9784 },
  { key: "new_delhi_ind", name: "New Delhi", iso3: "IND", latitude: 28.6139, longitude: 77.2090 },
  { key: "jakarta_idn", name: "Jakarta", iso3: "IDN", latitude: -6.2088, longitude: 106.8456 },
  { key: "tokyo_jpn", name: "Tokyo", iso3: "JPN", latitude: 35.6762, longitude: 139.6503 },
  { key: "new_york_usa", name: "New York", iso3: "USA", latitude: 40.7128, longitude: -74.0060 },
  { key: "los_angeles_usa", name: "Los Angeles", iso3: "USA", latitude: 34.0522, longitude: -118.2437 },
  { key: "sao_paulo_bra", name: "São Paulo", iso3: "BRA", latitude: -23.5558, longitude: -46.6396 },
];

type OpenMeteoResponse = {
  latitude: number;
  longitude: number;
  generationtime_ms?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  current?: {
    time: string;
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
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation?: number[];
    rain?: number[];
    wind_speed_10m?: number[];
    wind_gusts_10m?: number[];
  };
};

function weatherCodeRisk(code: number | undefined): number {
  if (code == null) return 0;
  if ([95, 96, 99].includes(code)) return 85; // thunderstorm
  if ([80, 81, 82].includes(code)) return 70; // rain showers
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 65; // snow
  if ([61, 63, 65, 66, 67].includes(code)) return 55; // rain/freezing rain
  if ([45, 48].includes(code)) return 35; // fog
  return 10;
}

function anomalyScore(data: OpenMeteoResponse): number {
  const current = data.current ?? {};
  const temp = current.temperature_2m ?? 0;
  const precipitation = current.precipitation ?? current.rain ?? 0;
  const wind = current.wind_speed_10m ?? 0;
  const gust = current.wind_gusts_10m ?? 0;
  const codeRisk = weatherCodeRisk(current.weather_code);

  const heatRisk = temp >= 42 ? 90 : temp >= 38 ? 75 : temp >= 34 ? 55 : 0;
  const coldRisk = temp <= -25 ? 85 : temp <= -15 ? 65 : temp <= -5 ? 35 : 0;
  const rainRisk = precipitation >= 30 ? 90 : precipitation >= 15 ? 70 : precipitation >= 5 ? 45 : 0;
  const windRisk = gust >= 100 ? 95 : gust >= 75 ? 75 : wind >= 50 ? 55 : 0;

  return Math.max(0, Math.min(100, Math.round(Math.max(codeRisk, heatRisk, coldRisk, rainRisk, windRisk))));
}

function observationRows(region: WatchRegion, data: OpenMeteoResponse) {
  const current = data.current ?? {};
  const observedAt = current.time ? new Date(current.time).toISOString() : new Date().toISOString();
  const anomaly = anomalyScore(data);
  const rows = [];

  const push = (type: string, value: number | undefined, unit: string, extra: Record<string, unknown> = {}) => {
    if (value == null || Number.isNaN(value)) return;
    rows.push({
      connector_key: CONNECTOR_KEY,
      observation_type: type,
      observed_entity: region.name,
      observed_region: region.iso3,
      observed_at: observedAt,
      observation_value: value,
      observation_unit: unit,
      confidence_score: 88,
      anomaly_score: anomaly,
      raw_payload: {
        region_key: region.key,
        region_name: region.name,
        iso3: region.iso3,
        latitude: region.latitude,
        longitude: region.longitude,
        weather_code: current.weather_code ?? null,
        provider: "Open-Meteo",
        feed: "forecast/current",
        ...extra,
      },
    });
  };

  push("weather_temperature", current.temperature_2m, "celsius");
  push("weather_humidity", current.relative_humidity_2m, "percent");
  push("weather_precipitation", current.precipitation ?? current.rain, "mm");
  push("weather_wind_speed", current.wind_speed_10m, "kmh");
  push("weather_wind_gust", current.wind_gusts_10m, "kmh");
  push("weather_extreme_risk", anomaly, "risk_score", { risk_basis: "temperature_precipitation_wind_weather_code" });

  return rows;
}

async function recordConnectorHealth(
  supabase: ReturnType<typeof createClient>,
  args: { success: boolean; inserted?: number; durationMs?: number; error?: string },
) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("telemetry_connectors")
    .select("consecutive_failures")
    .eq("connector_key", CONNECTOR_KEY)
    .maybeSingle();

  const failures = args.success ? 0 : (existing?.consecutive_failures ?? 0) + 1;

  await supabase.from("telemetry_connectors").upsert({
    connector_key: CONNECTOR_KEY,
    connector_name: "Open-Meteo Weather Telemetry",
    connector_type: "weather",
    provider_name: "Open-Meteo",
    data_domain: "climate-disaster",
    geographic_scope: "selected-global-watch-regions",
    auth_mode: "none",
    polling_interval_seconds: 900,
    operational_status: args.success ? "active" : "degraded",
    last_success_at: args.success ? now : undefined,
    last_failure_at: args.success ? undefined : now,
    consecutive_failures: failures,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      provider_url: "https://open-meteo.com/",
      watch_regions: WATCH_REGIONS.map((r) => r.key),
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
    },
    updated_at: now,
  }, { onConflict: "connector_key" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const url = new URL(req.url);
    const regionParam = url.searchParams.get("region");
    const regions = regionParam
      ? WATCH_REGIONS.filter((r) => r.key === regionParam || r.iso3 === regionParam.toUpperCase())
      : WATCH_REGIONS;

    const rows = [];
    for (const region of regions) {
      const api = new URL("https://api.open-meteo.com/v1/forecast");
      api.searchParams.set("latitude", String(region.latitude));
      api.searchParams.set("longitude", String(region.longitude));
      api.searchParams.set("current", [
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
      api.searchParams.set("hourly", "temperature_2m,precipitation,rain,wind_speed_10m,wind_gusts_10m");
      api.searchParams.set("forecast_days", "1");
      api.searchParams.set("timezone", "UTC");

      const res = await fetch(api.toString(), { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`Open-Meteo failed for ${region.key}: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as OpenMeteoResponse;
      rows.push(...observationRows(region, data));
    }

    let inserted = 0;
    if (rows.length > 0) {
      // No unique constraint yet; idempotency by observation tuple in recent window.
      const since = new Date(Date.now() - 2 * 3600_000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from("telemetry_observations")
        .select("observation_type,observed_region,observed_at")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", since);
      if (existingErr) throw existingErr;

      const seen = new Set((existing ?? []).map((r: any) => `${r.observation_type}|${r.observed_region}|${r.observed_at}`));
      const fresh = rows.filter((r: any) => !seen.has(`${r.observation_type}|${r.observed_region}|${r.observed_at}`));
      if (fresh.length > 0) {
        const { error: insertErr } = await supabase.from("telemetry_observations").insert(fresh);
        if (insertErr) throw insertErr;
        inserted = fresh.length;
      }
    }

    await recordConnectorHealth(supabase, { success: true, inserted, durationMs: Date.now() - started });

    await supabase.from("automation_logs").insert({
      job_name: "ingest-openmeteo-weather-telemetry",
      status: "success",
      message: `regions=${regions.length} observations=${rows.length} inserted=${inserted} duration_ms=${Date.now() - started}`,
    });

    try {
      await supabase.rpc("generate_telemetry_health_summary");
      await supabase.rpc("generate_strategic_digital_twins");
    } catch (e) {
      console.warn("post weather telemetry refresh skipped", e);
    }

    return new Response(JSON.stringify({
      status: "success",
      connector_key: CONNECTOR_KEY,
      regions: regions.length,
      observations: rows.length,
      inserted,
      duration_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordConnectorHealth(supabase, { success: false, durationMs: Date.now() - started, error: msg });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-openmeteo-weather-telemetry",
      status: "error",
      message: msg.slice(0, 500),
    });

    return new Response(JSON.stringify({ status: "error", error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
