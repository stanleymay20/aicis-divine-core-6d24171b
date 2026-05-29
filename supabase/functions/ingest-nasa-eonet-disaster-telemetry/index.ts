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

const CONNECTOR_KEY = "nasa_eonet_disaster_telemetry";
const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events";

type EonetCategory = {
  id: string;
  title: string;
};

type EonetGeometry = {
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
  date?: string | null;
  type?: string | null;
  coordinates?: unknown;
};

type EonetEvent = {
  id: string;
  title: string;
  description?: string | null;
  link?: string | null;
  closed?: string | null;
  categories?: EonetCategory[];
  sources?: { id: string; url?: string }[];
  geometry?: EonetGeometry[];
};

type EonetResponse = {
  title?: string;
  description?: string;
  link?: string;
  events?: EonetEvent[];
};

function primaryCategory(event: EonetEvent): string {
  return event.categories?.[0]?.id || event.categories?.[0]?.title || "natural_event";
}

function categoryRisk(category: string): number {
  const c = category.toLowerCase();
  if (c.includes("wildfire")) return 80;
  if (c.includes("volcano")) return 78;
  if (c.includes("severe") || c.includes("storm")) return 72;
  if (c.includes("flood")) return 75;
  if (c.includes("drought")) return 68;
  if (c.includes("sea") || c.includes("lake") || c.includes("ice")) return 45;
  if (c.includes("dust") || c.includes("haze") || c.includes("smoke")) return 50;
  if (c.includes("temperature")) return 60;
  return 40;
}

function anomalyScore(event: EonetEvent): number {
  const cat = primaryCategory(event);
  const base = categoryRisk(cat);
  const openBoost = event.closed ? 0 : 8;
  const sourceBoost = Math.min(12, (event.sources?.length ?? 0) * 3);
  const magValues = (event.geometry ?? [])
    .map((g) => typeof g.magnitudeValue === "number" ? g.magnitudeValue : 0)
    .filter((n) => n > 0);
  const magnitudeBoost = magValues.length > 0 ? Math.min(15, Math.max(...magValues) / 10) : 0;
  return Math.max(0, Math.min(100, Math.round(base + openBoost + sourceBoost + magnitudeBoost)));
}

function extractCoordinates(event: EonetEvent): { lat: number | null; lon: number | null } {
  const geom = event.geometry?.[0];
  const coords = geom?.coordinates;
  if (!Array.isArray(coords)) return { lat: null, lon: null };

  // EONET point geometry usually: [lon, lat]
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return { lon: coords[0], lat: coords[1] };
  }

  // Polygon/multipoint fallback: find first numeric pair recursively.
  const stack: unknown[] = [coords];
  while (stack.length) {
    const cur = stack.pop();
    if (!Array.isArray(cur)) continue;
    if (typeof cur[0] === "number" && typeof cur[1] === "number") {
      return { lon: cur[0], lat: cur[1] };
    }
    for (const item of cur) stack.push(item);
  }
  return { lat: null, lon: null };
}

function regionFromEvent(event: EonetEvent): string {
  const title = event.title || "";
  const parts = title.split(" - ");
  if (parts.length > 1) return parts[parts.length - 1].trim() || "GLOBAL";
  const comma = title.split(",");
  if (comma.length > 1) return comma[comma.length - 1].trim() || "GLOBAL";
  return "GLOBAL";
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    connector_name: "NASA EONET Disaster Telemetry",
    connector_type: "natural-hazards",
    provider_name: "NASA EONET",
    data_domain: "climate-disaster",
    geographic_scope: "global",
    auth_mode: "none",
    polling_interval_seconds: 1800,
    operational_status: args.success ? "active" : "degraded",
    last_success_at: args.success ? now : undefined,
    last_failure_at: args.success ? undefined : now,
    consecutive_failures: failures,
    last_error_message: args.success ? null : (args.error ?? "unknown").slice(0, 500),
    trust_tier: "tier_1",
    cost_tier: "free-public",
    metadata: {
      provider_url: "https://eonet.gsfc.nasa.gov/",
      source_url: EONET_URL,
      inserted: args.inserted ?? 0,
      duration_ms: args.durationMs ?? null,
      purpose: "wildfire storm flood volcano drought dust smoke and other natural-hazard event monitoring",
    },
    updated_at: now,
  }, { onConflict: "connector_key" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const __telemetryRun = await startProviderRun(supabase, {
    provider_name: "nasa_eonet",
    endpoint: "ingest-nasa-eonet-disaster-telemetry",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") ?? 20)));
    const status = url.searchParams.get("status") ?? "open";
    const limit = Math.max(10, Math.min(500, Number(url.searchParams.get("limit") ?? 250)));

    const api = new URL(EONET_URL);
    api.searchParams.set("days", String(days));
    api.searchParams.set("status", status);
    api.searchParams.set("limit", String(limit));

    const res = await fetch(api.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "AICIS-Divine-Core/1.0 NASA EONET telemetry",
      },
    });
    if (!res.ok) throw new Error(`NASA EONET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);

    const feed = (await res.json()) as EonetResponse;
    const events = Array.isArray(feed.events) ? feed.events : [];
    const rows = [];

    for (const event of events) {
      const cat = primaryCategory(event);
      const geom = event.geometry?.[0];
      const observedAt = geom?.date ? new Date(geom.date).toISOString() : new Date().toISOString();
      const { lat, lon } = extractCoordinates(event);
      const anomaly = anomalyScore(event);
      const region = regionFromEvent(event);
      const dedup = await sha256Hex(`${CONNECTOR_KEY}|${event.id}|${observedAt}|${cat}`);

      rows.push({
        connector_key: CONNECTOR_KEY,
        observation_type: `natural_hazard_${cat.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        observed_entity: event.title,
        observed_region: region,
        observed_at: observedAt,
        observation_value: anomaly,
        observation_unit: "risk_score",
        confidence_score: event.sources?.length ? Math.min(95, 75 + event.sources.length * 5) : 75,
        anomaly_score: anomaly,
        raw_payload: {
          eonet_id: event.id,
          dedup_hash: dedup,
          title: event.title,
          description: event.description,
          link: event.link,
          category: cat,
          categories: event.categories ?? [],
          sources: event.sources ?? [],
          closed: event.closed,
          magnitude_value: geom?.magnitudeValue ?? null,
          magnitude_unit: geom?.magnitudeUnit ?? null,
          geometry_type: geom?.type ?? null,
          latitude: lat,
          longitude: lon,
          provider: "NASA EONET",
          feed: "events",
        },
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      const since = new Date(Date.now() - 45 * 24 * 3600_000).toISOString();
      const { data: existing, error: existingErr } = await supabase
        .from("telemetry_observations")
        .select("raw_payload")
        .eq("connector_key", CONNECTOR_KEY)
        .gte("created_at", since);
      if (existingErr) throw existingErr;

      const existingHashes = new Set((existing ?? []).map((r: any) => r?.raw_payload?.dedup_hash).filter(Boolean));
      const fresh = rows.filter((r: any) => !existingHashes.has(r.raw_payload.dedup_hash));
      if (fresh.length > 0) {
        const { error: insertErr } = await supabase.from("telemetry_observations").insert(fresh);
        if (insertErr) throw insertErr;
        inserted = fresh.length;
      }
    }

    await recordConnectorHealth(supabase, { success: true, inserted, durationMs: Date.now() - started });

    await supabase.from("automation_logs").insert({
      job_name: "ingest-nasa-eonet-disaster-telemetry",
      status: "success",
      message: `events=${events.length} inserted=${inserted} duration_ms=${Date.now() - started}`,
    });

    try {
      await supabase.rpc("generate_telemetry_health_summary");
      await supabase.rpc("generate_strategic_digital_twins");
      await supabase.rpc("generate_operational_risk_assessments");
    } catch (e) {
      console.warn("post EONET telemetry refresh skipped", e);
    }
    await finishProviderRun(supabase, __telemetryRun);


    return new Response(JSON.stringify({
      status: "success",
      connector_key: CONNECTOR_KEY,
      events: events.length,
      inserted,
      duration_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordConnectorHealth(supabase, { success: false, durationMs: Date.now() - started, error: msg });
    await supabase.from("automation_logs").insert({
      job_name: "ingest-nasa-eonet-disaster-telemetry",
      status: "error",
      message: msg.slice(0, 500),
    });
    await failProviderRun(supabase, __telemetryRun, e);

    return new Response(JSON.stringify({ status: "error", error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
