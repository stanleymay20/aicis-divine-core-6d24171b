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

const CONNECTOR_KEY = "usgs_earthquake_telemetry";
const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";

interface UsgsFeature {
  id: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    updated?: number | null;
    url?: string | null;
    detail?: string | null;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    alert?: string | null;
    status?: string | null;
    tsunami?: number | null;
    sig?: number | null;
    net?: string | null;
    code?: string | null;
    nst?: number | null;
    dmin?: number | null;
    rms?: number | null;
    gap?: number | null;
    magType?: string | null;
    title?: string | null;
  };
  geometry?: {
    coordinates?: [number, number, number?];
  } | null;
}

interface UsgsFeed {
  features?: UsgsFeature[];
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
  raw_payload: Record<string, unknown> & { dedup_hash: string };
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

function regionFromPlace(place: string | null | undefined): string {
  if (!place) return "UNKNOWN";
  const parts = place.split(",");
  const tail = parts.at(-1)?.trim();
  return tail || place.trim() || "UNKNOWN";
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
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function recordConnectorHealth(
  supabase: ReturnType<typeof createClient>,
  args: { success: boolean; inserted?: number; durationMs?: number; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("telemetry_connectors")
    .select("consecutive_failures")
    .eq("connector_key", CONNECTOR_KEY)
    .maybeSingle();
  if (existingError) console.error("USGS connector health lookup failed", existingError.message);

  const failures = args.success ? 0 : Number(existing?.consecutive_failures ?? 0) + 1;
  const row: Record<string, unknown> = {
    connector_key: CONNECTOR_KEY,
    connector_name: "USGS Earthquake Telemetry",
    connector_type: "earthquake",
    provider_name: "USGS",
    data_domain: "geophysical-disaster",
    geographic_scope: "global",
    auth_mode: "none",
    polling_interval_seconds: 300,
    operational_status: args.success ? "active" : "degraded",
    consecutive_failures: failures,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      source_url: USGS_FEED,
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
      feed_window: "1h",
      analytical_scores: "not_assessed_at_ingestion",
    },
    updated_at: now,
  };
  if (args.success) row.last_success_at = now;
  else row.last_failure_at = now;

  const { error } = await supabase
    .from("telemetry_connectors")
    .upsert(row, { onConflict: "connector_key" });
  if (error) console.error("USGS connector health upsert failed", error.message);
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
    provider_name: "usgs",
    endpoint: "ingest-usgs-earthquake-telemetry",
    scheduler_source: auth.via === "cron" ? "cron" : "admin",
  });

  try {
    const response = await fetch(USGS_FEED, {
      headers: {
        "Accept": "application/geo+json, application/json",
        "User-Agent": "AICIS/1.0 telemetry ingestion",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`USGS feed failed: HTTP ${response.status}`);

    const feed = await response.json() as UsgsFeed;
    const features = Array.isArray(feed.features) ? feed.features : [];
    const rows: TelemetryRow[] = [];

    for (const feature of features) {
      const id = feature.id?.trim();
      const magnitude = finiteOrNull(feature.properties?.mag);
      const observedTimeMs = finiteOrNull(feature.properties?.time);
      if (!id || magnitude === null || observedTimeMs === null) continue;

      const observedAt = new Date(observedTimeMs).toISOString();
      const coordinates = feature.geometry?.coordinates;
      const longitude = finiteOrNull(coordinates?.[0]);
      const latitude = finiteOrNull(coordinates?.[1]);
      const depthKm = finiteOrNull(coordinates?.[2]);
      const dedupHash = await sha256Hex(`${CONNECTOR_KEY}|${id}|${observedAt}|${magnitude}`);

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: "earthquake_magnitude",
        observed_entity: feature.properties?.title ?? feature.properties?.place ?? id,
        observed_region: regionFromPlace(feature.properties?.place),
        observed_at: observedAt,
        observation_value: magnitude,
        observation_unit: "magnitude",
        confidence_score: null,
        anomaly_score: null,
        raw_payload: {
          usgs_id: id,
          dedup_hash: dedupHash,
          place: feature.properties?.place ?? null,
          title: feature.properties?.title ?? null,
          url: feature.properties?.url ?? null,
          detail: feature.properties?.detail ?? null,
          magnitude,
          magnitude_type: feature.properties?.magType ?? null,
          significance: finiteOrNull(feature.properties?.sig),
          alert: feature.properties?.alert ?? null,
          tsunami: finiteOrNull(feature.properties?.tsunami),
          felt: finiteOrNull(feature.properties?.felt),
          cdi: finiteOrNull(feature.properties?.cdi),
          mmi: finiteOrNull(feature.properties?.mmi),
          status: feature.properties?.status ?? null,
          net: feature.properties?.net ?? null,
          code: feature.properties?.code ?? null,
          station_count: finiteOrNull(feature.properties?.nst),
          minimum_distance: finiteOrNull(feature.properties?.dmin),
          rms: finiteOrNull(feature.properties?.rms),
          azimuthal_gap: finiteOrNull(feature.properties?.gap),
          provider_updated_at: finiteOrNull(feature.properties?.updated) !== null
            ? new Date(Number(feature.properties?.updated)).toISOString()
            : null,
          latitude,
          longitude,
          depth_km: depthKm,
          provider: "USGS",
          feed: "all_hour.geojson",
          analytical_confidence: "not_assessed",
          analytical_anomaly: "not_assessed",
        },
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", new Date(Date.now() - 6 * 3_600_000).toISOString());
      if (existingError) throw existingError;

      const existingHashes = new Set(
        ((existing ?? []) as ExistingTelemetry[])
          .map((row) => dedupHashFromPayload(row.raw_payload))
          .filter((hash): hash is string => Boolean(hash)),
      );
      const freshRows = rows.filter((row) => !existingHashes.has(row.raw_payload.dedup_hash));

      if (freshRows.length > 0) {
        const { error } = await supabase.from("telemetry_observations").insert(freshRows);
        if (error) throw error;
        inserted = freshRows.length;
      }
    }

    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, { success: true, inserted, durationMs });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-usgs-earthquake-telemetry",
      status: "success",
      message: `features=${features.length} normalized=${rows.length} inserted=${inserted} duration_ms=${durationMs}`,
    });

    const { error: healthSummaryError } = await supabase.rpc("generate_telemetry_health_summary");
    if (healthSummaryError) console.warn("telemetry health refresh skipped", healthSummaryError.message);

    await finishProviderRun(supabase, run, {
      records_fetched: features.length,
      records_inserted: inserted,
      records_normalized: rows.length,
    });
    return json({
      status: "success",
      connector_key: CONNECTOR_KEY,
      features: features.length,
      normalized: rows.length,
      inserted,
      duration_ms: durationMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, { success: false, durationMs, error: message });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-usgs-earthquake-telemetry",
      status: "error",
      message: message.slice(0, 500),
    });
    await failProviderRun(supabase, run, error);
    return json({ status: "error", error: message }, 500);
  }
});
