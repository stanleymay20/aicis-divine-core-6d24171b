import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONNECTOR_KEY = "openmeteo_global_mesh_telemetry";

type MeshCell = {
  cell_key: string;
  coverage_domain: string;
  label: string | null;
  iso3: string | null;
  region_group: string | null;
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
  centroid_lat: number;
  centroid_lon: number;
  priority_tier: string;
  polling_interval_seconds: number;
  shard_key: number;
};

type OpenMeteoResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    rain?: number;
    snowfall?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
  };
};

function weatherCodeRisk(code: number | undefined): number {
  if (code == null) return 0;
  if ([95, 96, 99].includes(code)) return 85;
  if ([80, 81, 82].includes(code)) return 70;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 65;
  if ([61, 63, 65, 66, 67].includes(code)) return 55;
  if ([45, 48].includes(code)) return 35;
  return 10;
}

function anomalyScore(data: OpenMeteoResponse): number {
  const c = data.current ?? {};
  const temp = c.temperature_2m ?? 0;
  const precipitation = c.precipitation ?? c.rain ?? 0;
  const wind = c.wind_speed_10m ?? 0;
  const gust = c.wind_gusts_10m ?? 0;
  const heatRisk = temp >= 42 ? 90 : temp >= 38 ? 75 : temp >= 34 ? 55 : 0;
  const coldRisk = temp <= -25 ? 85 : temp <= -15 ? 65 : temp <= -5 ? 35 : 0;
  const rainRisk = precipitation >= 30 ? 90 : precipitation >= 15 ? 70 : precipitation >= 5 ? 45 : 0;
  const windRisk = gust >= 100 ? 95 : gust >= 75 ? 75 : wind >= 50 ? 55 : 0;
  return Math.max(0, Math.min(100, Math.round(Math.max(weatherCodeRisk(c.weather_code), heatRisk, coldRisk, rainRisk, windRisk))));
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rowsForCell(cell: MeshCell, data: OpenMeteoResponse) {
  const current = data.current ?? {};
  const observedAt = current.time ? new Date(current.time).toISOString() : new Date().toISOString();
  const anomaly = anomalyScore(data);
  const basePayload = {
    cell_key: cell.cell_key,
    cell_label: cell.label,
    iso3: cell.iso3 ?? "GLOBAL",
    region_group: cell.region_group,
    centroid_lat: cell.centroid_lat,
    centroid_lon: cell.centroid_lon,
    min_lat: cell.min_lat,
    max_lat: cell.max_lat,
    min_lon: cell.min_lon,
    max_lon: cell.max_lon,
    shard_key: cell.shard_key,
    provider: "Open-Meteo",
    coverage_model: "true_global_weather_mesh",
    weather_code: current.weather_code ?? null,
  };

  const rows: any[] = [];
  const push = (type: string, value: number | undefined, unit: string) => {
    if (value == null || Number.isNaN(value)) return;
    rows.push({
      connector_key: CONNECTOR_KEY,
      observation_type: type,
      observed_entity: cell.label ?? cell.cell_key,
      observed_region: cell.iso3 ?? "GLOBAL",
      observed_at: observedAt,
      observation_value: value,
      observation_unit: unit,
      confidence_score: 88,
      anomaly_score: anomaly,
      raw_payload: { ...basePayload },
    });
  };

  push("weather_mesh_temperature", current.temperature_2m, "celsius");
  push("weather_mesh_humidity", current.relative_humidity_2m, "percent");
  push("weather_mesh_precipitation", current.precipitation ?? current.rain, "mm");
  push("weather_mesh_wind_speed", current.wind_speed_10m, "kmh");
  push("weather_mesh_wind_gust", current.wind_gusts_10m, "kmh");
  push("weather_mesh_extreme_risk", anomaly, "risk_score");
  return rows;
}

async function fetchOpenMeteo(cell: MeshCell): Promise<OpenMeteoResponse> {
  const api = new URL("https://api.open-meteo.com/v1/forecast");
  api.searchParams.set("latitude", String(cell.centroid_lat));
  api.searchParams.set("longitude", String(cell.centroid_lon));
  api.searchParams.set("current", [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "rain",
    "snowfall",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
  ].join(","));
  api.searchParams.set("forecast_days", "1");
  api.searchParams.set("timezone", "UTC");
  const res = await fetch(api.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open-Meteo failed for ${cell.cell_key}: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function recordConnectorHealth(supabase: ReturnType<typeof createClient>, args: { success: boolean; inserted?: number; durationMs?: number; error?: string; cells?: number }) {
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from("telemetry_connectors").select("consecutive_failures").eq("connector_key", CONNECTOR_KEY).maybeSingle();
  const failures = args.success ? 0 : (existing?.consecutive_failures ?? 0) + 1;
  await supabase.from("telemetry_connectors").upsert({
    connector_key: CONNECTOR_KEY,
    connector_name: "Open-Meteo Global Mesh Telemetry",
    connector_type: "weather-grid",
    provider_name: "Open-Meteo",
    data_domain: "weather-climate",
    geographic_scope: "true-global-grid",
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
      coverage_model: "216-cell global weather mesh via global_telemetry_coverage_cells",
      cells: args.cells ?? 0,
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
  const __telemetryRun = await startProviderRun(supabase, {
    provider_name: "openmeteo_global",
    endpoint: "ingest-openmeteo-global-mesh",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  let runId: string | null = null;

  try {
    const url = new URL(req.url);
    const shardParam = url.searchParams.get("shard");
    const shard = shardParam == null ? null : Number(shardParam);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 12)));

    const { data: runCreated } = await supabase.rpc("start_global_coverage_run", { p_coverage_domain: "weather-climate", p_shard_key: shard });
    runId = runCreated ?? null;

    const { data: cells, error: cellErr } = await supabase.rpc("get_due_global_telemetry_cells", {
      p_coverage_domain: "weather-climate",
      p_shard_key: shard,
      p_limit: limit,
    });
    if (cellErr) throw cellErr;
    const meshCells = (cells ?? []) as MeshCell[];

    const rows: any[] = [];
    let successfulCells = 0;
    const errors: string[] = [];

    for (const cell of meshCells) {
      try {
        const data = await fetchOpenMeteo(cell);
        const cellRows = rowsForCell(cell, data);
        for (const r of cellRows) {
          r.raw_payload.dedup_hash = await sha256Hex(`${CONNECTOR_KEY}|${r.observation_type}|${cell.cell_key}|${r.observed_at}`);
        }
        rows.push(...cellRows);
        successfulCells++;
        await supabase.rpc("record_global_cell_poll", { p_cell_key: cell.cell_key, p_success: true, p_observation_count: cellRows.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        await supabase.rpc("record_global_cell_poll", { p_cell_key: cell.cell_key, p_success: false, p_observation_count: 0, p_error: msg });
      }
    }

    let inserted = 0;
    if (rows.length > 0) {
      const since = new Date(Date.now() - 8 * 3600_000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", since);
      if (existingErr) throw existingErr;
      const seen = new Set((existing ?? []).map((r: any) => r?.raw_payload?.dedup_hash).filter(Boolean));
      const fresh = rows.filter((r) => !seen.has(r.raw_payload.dedup_hash));
      if (fresh.length > 0) {
        const { error: insertErr } = await supabase.from("telemetry_observations").insert(fresh);
        if (insertErr) throw insertErr;
        inserted = fresh.length;
      }
    }

    if (runId) {
      await supabase.rpc("finish_global_coverage_run", {
        p_run_id: runId,
        p_cells_attempted: meshCells.length,
        p_cells_successful: successfulCells,
        p_observations_inserted: inserted,
        p_status: errors.length ? "partial_success" : "success",
        p_error: errors.slice(0, 3).join(" | ") || null,
      });
    }

    await recordConnectorHealth(supabase, { success: true, inserted, cells: meshCells.length, durationMs: Date.now() - started });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-openmeteo-global-mesh",
      status: errors.length ? "partial_success" : "success",
      message: `shard=${shard ?? "all"} cells=${meshCells.length} ok=${successfulCells} inserted=${inserted} errors=${errors.length}`,
    });

    try {
      await supabase.rpc("generate_telemetry_health_summary");
      await supabase.rpc("generate_strategic_digital_twins");
    } catch (_) {}

    return new Response(JSON.stringify({
      status: errors.length ? "partial_success" : "success",
      connector_key: CONNECTOR_KEY,
      shard,
      cells_attempted: meshCells.length,
      cells_successful: successfulCells,
      observations: rows.length,
      inserted,
      errors: errors.slice(0, 5),
      duration_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordConnectorHealth(supabase, { success: false, durationMs: Date.now() - started, error: msg });
    if (runId) {
      await supabase.rpc("finish_global_coverage_run", { p_run_id: runId, p_cells_attempted: 0, p_cells_successful: 0, p_observations_inserted: 0, p_status: "error", p_error: msg });
    }
    await supabase.from("automation_logs").insert({ job_name: "ingest-openmeteo-global-mesh", status: "error", message: msg.slice(0, 500) });
    await failProviderRun(supabase, __telemetryRun, e);
    return new Response(JSON.stringify({ status: "error", error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
