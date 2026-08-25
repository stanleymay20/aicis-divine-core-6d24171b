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

const CONNECTOR_KEY = "openmeteo_global_mesh_telemetry";

interface MeshCell {
  cell_key: string;
  label: string | null;
  iso3: string | null;
  region_group: string | null;
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
  centroid_lat: number;
  centroid_lon: number;
  shard_key: number;
}

interface OpenMeteoResponse {
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
}

interface MeshTelemetryRow {
  connector_key: string;
  observation_type: string;
  observed_entity: string;
  observed_region: string;
  observed_at: string;
  observation_value: number;
  observation_unit: string;
  confidence_score: null;
  anomaly_score: null;
  raw_payload: Record<string, unknown> & { dedup_hash?: string };
}

interface ExistingTelemetry {
  raw_payload: unknown;
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

function dedupHashFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).dedup_hash;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function rowsForCell(cell: MeshCell, data: OpenMeteoResponse): MeshTelemetryRow[] {
  const current = data.current;
  if (!current?.time) return [];
  const observedAtMs = Date.parse(current.time);
  if (!Number.isFinite(observedAtMs)) return [];
  const observedAt = new Date(observedAtMs).toISOString();
  const rows: MeshTelemetryRow[] = [];
  const basePayload = {
    cell_key: cell.cell_key,
    cell_label: cell.label,
    iso3: cell.iso3 ?? null,
    region_group: cell.region_group,
    centroid_lat: cell.centroid_lat,
    centroid_lon: cell.centroid_lon,
    min_lat: cell.min_lat,
    max_lat: cell.max_lat,
    min_lon: cell.min_lon,
    max_lon: cell.max_lon,
    shard_key: cell.shard_key,
    provider: "Open-Meteo",
    coverage_model: "configured_global_weather_mesh",
    weather_code: finiteOrNull(current.weather_code),
    analytical_confidence: "not_assessed",
    analytical_anomaly: "not_assessed",
  };

  const push = (type: string, rawValue: unknown, unit: string): void => {
    const value = finiteOrNull(rawValue);
    if (value === null) return;
    rows.push({
      connector_key: CONNECTOR_KEY,
      observation_type: type,
      observed_entity: cell.label ?? cell.cell_key,
      observed_region: cell.iso3 ?? "GLOBAL",
      observed_at: observedAt,
      observation_value: value,
      observation_unit: unit,
      confidence_score: null,
      anomaly_score: null,
      raw_payload: { ...basePayload },
    });
  };

  push("weather_mesh_temperature", current.temperature_2m, "celsius");
  push("weather_mesh_humidity", current.relative_humidity_2m, "percent");
  push("weather_mesh_precipitation", current.precipitation ?? current.rain, "mm");
  push("weather_mesh_rain", current.rain, "mm");
  push("weather_mesh_snowfall", current.snowfall, "cm");
  push("weather_mesh_wind_speed", current.wind_speed_10m, "kmh");
  push("weather_mesh_wind_gust", current.wind_gusts_10m, "kmh");
  push("weather_mesh_code", current.weather_code, "wmo_code");
  return rows;
}

async function fetchOpenMeteo(cell: MeshCell): Promise<OpenMeteoResponse> {
  const apiUrl = new URL("https://api.open-meteo.com/v1/forecast");
  apiUrl.searchParams.set("latitude", String(cell.centroid_lat));
  apiUrl.searchParams.set("longitude", String(cell.centroid_lon));
  apiUrl.searchParams.set("current", [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "rain",
    "snowfall",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
  ].join(","));
  apiUrl.searchParams.set("forecast_days", "1");
  apiUrl.searchParams.set("timezone", "UTC");
  const response = await fetch(apiUrl, {
    headers: { "Accept": "application/json", "User-Agent": "AICIS/1.0 Open-Meteo global mesh" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Open-Meteo failed for ${cell.cell_key}: HTTP ${response.status}`);
  return await response.json() as OpenMeteoResponse;
}

async function recordConnectorHealth(
  supabase: ReturnType<typeof createClient>,
  args: { success: boolean; inserted?: number; durationMs?: number; error?: string; cells?: number },
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabase
    .from("telemetry_connectors")
    .select("consecutive_failures")
    .eq("connector_key", CONNECTOR_KEY)
    .maybeSingle();
  if (lookupError) console.error("Open-Meteo mesh connector lookup failed", lookupError.message);

  const row: Record<string, unknown> = {
    connector_key: CONNECTOR_KEY,
    connector_name: "Open-Meteo Global Mesh Telemetry",
    connector_type: "weather-grid",
    provider_name: "Open-Meteo",
    data_domain: "weather-climate",
    geographic_scope: "configured-global-grid",
    auth_mode: "none",
    polling_interval_seconds: 900,
    operational_status: args.success ? "active" : "degraded",
    consecutive_failures: args.success ? 0 : Number(existing?.consecutive_failures ?? 0) + 1,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      provider_url: "https://open-meteo.com/",
      coverage_model: "configured weather mesh via global_telemetry_coverage_cells",
      cells: args.cells ?? 0,
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
  if (error) console.error("Open-Meteo mesh health upsert failed", error.message);
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
    provider_name: "openmeteo_global",
    endpoint: "ingest-openmeteo-global-mesh",
    scheduler_source: auth.via === "cron" ? "cron" : "admin",
  });
  let coverageRunId: string | null = null;

  try {
    const requestUrl = new URL(req.url);
    const rawShard = requestUrl.searchParams.get("shard");
    const parsedShard = rawShard === null ? null : Number(rawShard);
    const shard = parsedShard !== null && Number.isInteger(parsedShard) ? parsedShard : null;
    if (rawShard !== null && shard === null) return json({ error: "Invalid shard" }, 400);

    const parsedLimit = Number(requestUrl.searchParams.get("limit") ?? 12);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.trunc(parsedLimit))) : 12;

    const { data: createdRun, error: runError } = await supabase.rpc("start_global_coverage_run", {
      p_coverage_domain: "weather-climate",
      p_shard_key: shard,
    });
    if (runError) throw runError;
    coverageRunId = typeof createdRun === "string" ? createdRun : null;

    const { data: cells, error: cellError } = await supabase.rpc("get_due_global_telemetry_cells", {
      p_coverage_domain: "weather-climate",
      p_shard_key: shard,
      p_limit: limit,
    });
    if (cellError) throw cellError;
    const meshCells = (cells ?? []) as MeshCell[];

    const rows: MeshTelemetryRow[] = [];
    let successfulCells = 0;
    const errors: string[] = [];

    for (const cell of meshCells) {
      try {
        const cellRows = rowsForCell(cell, await fetchOpenMeteo(cell));
        for (const row of cellRows) {
          row.raw_payload.dedup_hash = await sha256Hex(`${CONNECTOR_KEY}|${row.observation_type}|${cell.cell_key}|${row.observed_at}`);
        }
        rows.push(...cellRows);
        successfulCells += 1;
        const { error } = await supabase.rpc("record_global_cell_poll", {
          p_cell_key: cell.cell_key,
          p_success: true,
          p_observation_count: cellRows.length,
        });
        if (error) errors.push(`cell_poll:${cell.cell_key}:${error.message}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        await supabase.rpc("record_global_cell_poll", {
          p_cell_key: cell.cell_key,
          p_success: false,
          p_observation_count: 0,
          p_error: message,
        });
      }
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", new Date(Date.now() - 8 * 3_600_000).toISOString());
      if (existingError) throw existingError;

      const seen = new Set(
        ((existing ?? []) as ExistingTelemetry[])
          .map((row) => dedupHashFromPayload(row.raw_payload))
          .filter((hash): hash is string => Boolean(hash)),
      );
      const freshRows = rows.filter((row) => {
        const hash = dedupHashFromPayload(row.raw_payload);
        return hash !== null && !seen.has(hash);
      });
      if (freshRows.length > 0) {
        const { error } = await supabase.from("telemetry_observations").insert(freshRows);
        if (error) throw error;
        inserted = freshRows.length;
      }
    }

    if (coverageRunId) {
      const { error } = await supabase.rpc("finish_global_coverage_run", {
        p_run_id: coverageRunId,
        p_cells_attempted: meshCells.length,
        p_cells_successful: successfulCells,
        p_observations_inserted: inserted,
        p_status: errors.length > 0 ? "partial_success" : "success",
        p_error: errors.slice(0, 3).join(" | ") || null,
      });
      if (error) errors.push(`finish_coverage_run:${error.message}`);
    }

    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, {
      success: successfulCells > 0 || meshCells.length === 0,
      inserted,
      cells: meshCells.length,
      durationMs,
      error: errors[0],
    });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-openmeteo-global-mesh",
      status: errors.length > 0 ? "partial_success" : "success",
      message: `shard=${shard ?? "all"} cells=${meshCells.length} ok=${successfulCells} observations=${rows.length} inserted=${inserted} errors=${errors.length}`,
    });

    for (const rpcName of ["generate_telemetry_health_summary", "generate_strategic_digital_twins"]) {
      const { error } = await supabase.rpc(rpcName);
      if (error) console.warn(`${rpcName} refresh skipped`, error.message);
    }

    await finishProviderRun(supabase, run, {
      records_fetched: meshCells.length,
      records_inserted: inserted,
      records_normalized: rows.length,
      error_count: errors.length,
      error_summary: errors[0] ?? null,
    });
    return json({
      status: errors.length > 0 ? "partial_success" : "success",
      connector_key: CONNECTOR_KEY,
      shard,
      cells_attempted: meshCells.length,
      cells_successful: successfulCells,
      observations: rows.length,
      inserted,
      errors: errors.slice(0, 5),
      duration_ms: durationMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, { success: false, durationMs, error: message });
    if (coverageRunId) {
      await supabase.rpc("finish_global_coverage_run", {
        p_run_id: coverageRunId,
        p_cells_attempted: 0,
        p_cells_successful: 0,
        p_observations_inserted: 0,
        p_status: "error",
        p_error: message,
      });
    }
    await supabase.from("automation_logs").insert({ job_name: "ingest-openmeteo-global-mesh", status: "error", message: message.slice(0, 500) });
    await failProviderRun(supabase, run, error);
    return json({ status: "error", error: message }, 500);
  }
});
