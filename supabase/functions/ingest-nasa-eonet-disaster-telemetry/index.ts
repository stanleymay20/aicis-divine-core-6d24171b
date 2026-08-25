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

const CONNECTOR_KEY = "nasa_eonet_disaster_telemetry";
const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events";

interface EonetCategory {
  id: string;
  title: string;
}

interface EonetGeometry {
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
  date?: string | null;
  type?: string | null;
  coordinates?: unknown;
}

interface EonetEvent {
  id: string;
  title: string;
  description?: string | null;
  link?: string | null;
  closed?: string | null;
  categories?: EonetCategory[];
  sources?: Array<{ id: string; url?: string }>;
  geometry?: EonetGeometry[];
}

interface EonetResponse {
  events?: EonetEvent[];
}

interface TelemetryRow {
  connector_key: string;
  observation_type: string;
  observed_entity: string;
  observed_region: string;
  observed_at: string;
  observation_value: number | null;
  observation_unit: string | null;
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

function primaryCategory(event: EonetEvent): string {
  return event.categories?.[0]?.id || event.categories?.[0]?.title || "natural_event";
}

function finiteOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractCoordinates(event: EonetEvent): { lat: number | null; lon: number | null } {
  const coordinates = event.geometry?.[0]?.coordinates;
  if (!Array.isArray(coordinates)) return { lat: null, lon: null };

  const stack: unknown[] = [coordinates];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!Array.isArray(current)) continue;
    const lon = finiteOrNull(current[0]);
    const lat = finiteOrNull(current[1]);
    if (lon !== null && lat !== null) return { lon, lat };
    for (const item of current) stack.push(item);
  }
  return { lat: null, lon: null };
}

function regionFromEvent(event: EonetEvent): string {
  const title = event.title || "";
  const dashParts = title.split(" - ");
  if (dashParts.length > 1) return dashParts.at(-1)?.trim() || "GLOBAL";
  const commaParts = title.split(",");
  if (commaParts.length > 1) return commaParts.at(-1)?.trim() || "GLOBAL";
  return "GLOBAL";
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
  if (lookupError) console.error("EONET connector lookup failed", lookupError.message);

  const row: Record<string, unknown> = {
    connector_key: CONNECTOR_KEY,
    connector_name: "NASA EONET Disaster Telemetry",
    connector_type: "natural-hazards",
    provider_name: "NASA EONET",
    data_domain: "climate-disaster",
    geographic_scope: "global",
    auth_mode: "none",
    polling_interval_seconds: 1800,
    operational_status: args.success ? "active" : "degraded",
    consecutive_failures: args.success ? 0 : Number(existing?.consecutive_failures ?? 0) + 1,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      provider_url: "https://eonet.gsfc.nasa.gov/",
      source_url: EONET_URL,
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
  if (error) console.error("EONET connector health upsert failed", error.message);
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
    provider_name: "nasa_eonet",
    endpoint: "ingest-nasa-eonet-disaster-telemetry",
    scheduler_source: auth.via === "cron" ? "cron" : "admin",
  });

  try {
    const requestUrl = new URL(req.url);
    const requestedDays = Number(requestUrl.searchParams.get("days") ?? 20);
    const requestedLimit = Number(requestUrl.searchParams.get("limit") ?? 250);
    const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(90, Math.trunc(requestedDays))) : 20;
    const limit = Number.isFinite(requestedLimit) ? Math.max(10, Math.min(500, Math.trunc(requestedLimit))) : 250;
    const statusParam = requestUrl.searchParams.get("status") ?? "open";
    const status = ["open", "closed", "all"].includes(statusParam) ? statusParam : "open";

    const apiUrl = new URL(EONET_URL);
    apiUrl.searchParams.set("days", String(days));
    apiUrl.searchParams.set("status", status);
    apiUrl.searchParams.set("limit", String(limit));

    const response = await fetch(apiUrl, {
      headers: { "Accept": "application/json", "User-Agent": "AICIS/1.0 NASA EONET telemetry" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`NASA EONET failed: HTTP ${response.status}`);

    const feed = await response.json() as EonetResponse;
    const events = Array.isArray(feed.events) ? feed.events : [];
    const rows: TelemetryRow[] = [];

    for (const event of events) {
      if (!event.id || !event.title) continue;
      const category = primaryCategory(event);
      const geometry = event.geometry?.[0];
      if (!geometry?.date) continue;
      const observedAtMs = Date.parse(geometry.date);
      if (!Number.isFinite(observedAtMs)) continue;
      const observedAt = new Date(observedAtMs).toISOString();
      const magnitude = finiteOrNull(geometry.magnitudeValue);
      const { lat, lon } = extractCoordinates(event);
      const dedupHash = await sha256Hex(`${CONNECTOR_KEY}|${event.id}|${observedAt}|${category}`);

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: `natural_hazard_${category.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        observed_entity: event.title,
        observed_region: regionFromEvent(event),
        observed_at: observedAt,
        observation_value: magnitude,
        observation_unit: magnitude !== null ? geometry.magnitudeUnit ?? null : null,
        confidence_score: null,
        anomaly_score: null,
        raw_payload: {
          eonet_id: event.id,
          dedup_hash: dedupHash,
          title: event.title,
          description: event.description ?? null,
          link: event.link ?? null,
          category,
          categories: event.categories ?? [],
          sources: event.sources ?? [],
          closed: event.closed ?? null,
          magnitude_value: magnitude,
          magnitude_unit: geometry.magnitudeUnit ?? null,
          geometry_type: geometry.type ?? null,
          latitude: lat,
          longitude: lon,
          provider: "NASA EONET",
          feed: "events",
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
        .gte("created_at", new Date(Date.now() - 45 * 86_400_000).toISOString());
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
      job_name: "ingest-nasa-eonet-disaster-telemetry",
      status: "success",
      message: `events=${events.length} normalized=${rows.length} inserted=${inserted} duration_ms=${durationMs}`,
    });

    for (const rpcName of ["generate_telemetry_health_summary", "generate_strategic_digital_twins", "generate_operational_risk_assessments"]) {
      const { error } = await supabase.rpc(rpcName);
      if (error) console.warn(`${rpcName} refresh skipped`, error.message);
    }

    await finishProviderRun(supabase, run, {
      records_fetched: events.length,
      records_inserted: inserted,
      records_normalized: rows.length,
    });
    return json({ status: "success", connector_key: CONNECTOR_KEY, events: events.length, normalized: rows.length, inserted, duration_ms: durationMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await recordConnectorHealth(supabase, { success: false, durationMs, error: message });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-nasa-eonet-disaster-telemetry",
      status: "error",
      message: message.slice(0, 500),
    });
    await failProviderRun(supabase, run, error);
    return json({ status: "error", error: message }, 500);
  }
});
