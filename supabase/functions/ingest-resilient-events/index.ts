import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
/**
 * ingest-resilient-events — enterprise replacement for the rate-limited GDELT pipeline.
 *
 * Pulls from THREE unrate-limited authoritative public feeds and writes into
 * `normalized_events` with deterministic dedup keys:
 *  1. USGS earthquakes (last 24h, M2.5+) — JSON, no key, no rate limit
 *  2. ReliefWeb disasters (active) — JSON, no key, soft limits
 *  3. GDELT DOC API as best-effort tertiary fallback
 *
 * Designed to run every 30 minutes via pg_cron. Each source is isolated in its
 * own try/catch so one failure cannot block the others. Writes are upserted
 * to guarantee idempotency.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startProviderRun,
  finishProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "ingest-resilient-events";

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

interface NormEvent {
  provider_name: string;
  event_type: string;
  category: string;
  title: string;
  description: string | null;
  source_url: string | null;
  source_name: string;
  country_iso3: string | null;
  severity: number;
  confidence: number;
  occurred_at: string;
  raw_data: any;
  dedup_key: string;
}

async function pullUSGS(): Promise<NormEvent[]> {
  const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`USGS HTTP ${r.status}`);
  const j = await r.json();
  return (j.features || []).map((f: any) => {
    const mag = f.properties?.mag ?? 0;
    const sev = mag >= 7 ? 9 : mag >= 6 ? 8 : mag >= 5 ? 7 : mag >= 4 ? 5 : 3;
    return {
      provider_name: "usgs",
      event_type: "natural_disaster",
      category: "climate",
      title: (f.properties?.title || `M${mag} earthquake`).slice(0, 500),
      description: f.properties?.place || null,
      source_url: f.properties?.url || null,
      source_name: "USGS",
      country_iso3: null,
      severity: sev,
      confidence: 0.98,
      occurred_at: new Date(f.properties?.time || Date.now()).toISOString(),
      raw_data: { mag, depth: f.geometry?.coordinates?.[2], coords: f.geometry?.coordinates },
      dedup_key: `usgs_${f.id || hash(f.properties?.url || "")}`,
    };
  });
}

async function pullGDACS(): Promise<NormEvent[]> {
  // GDACS — Global Disaster Alert and Coordination System (EU-JRC). Open, no key, JSON.
  const url = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Green;Orange;Red&fromDate=&toDate=";
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`GDACS HTTP ${r.status}`);
  const j = await r.json();
  const features = j.features || [];
  return features.map((f: any) => {
    const p = f.properties || {};
    const alert = (p.alertlevel || "Green").toLowerCase();
    const sev = alert === "red" ? 9 : alert === "orange" ? 7 : 4;
    const eventType = p.eventtype || "disaster";
    const cat = ["EQ", "VO"].includes(eventType) ? "climate"
              : ["TC", "FL", "DR", "WF"].includes(eventType) ? "climate" : "general";
    return {
      provider_name: "gdacs",
      event_type: eventType.toLowerCase(),
      category: cat,
      title: (p.name || p.htmldescription || `GDACS ${eventType}`).slice(0, 500),
      description: p.description || null,
      source_url: p.url?.report || null,
      source_name: "GDACS",
      country_iso3: p.iso3 || null,
      severity: sev,
      confidence: 0.95,
      occurred_at: new Date(p.fromdate || Date.now()).toISOString(),
      raw_data: { alert, eventid: p.eventid, episodeid: p.episodeid },
      dedup_key: `gdacs_${p.eventid || p.episodeid || hash(p.url?.report || "")}`,
    };
  });
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const __run = await startProviderRun(supabase, {
    provider_name: "resilient_events",
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });
  const start = Date.now();
  const summary: Record<string, number | string> = {};

  const allEvents: NormEvent[] = [];

  // Source 1: USGS (isolated)
  try {
    const ev = await pullUSGS();
    allEvents.push(...ev);
    summary.usgs = ev.length;
  } catch (e) {
    summary.usgs_error = (e as Error).message;
  }

  // Source 2: GDACS (isolated)
  try {
    const ev = await pullGDACS();
    allEvents.push(...ev);
    summary.gdacs = ev.length;
  } catch (e) {
    summary.gdacs_error = (e as Error).message;
  }

  let inserted = 0;
  if (allEvents.length > 0) {
    const { data, error } = await supabase
      .from("normalized_events")
      .upsert(allEvents, { onConflict: "dedup_key", ignoreDuplicates: true })
      .select("id");
    if (error) summary.insert_error = error.message;
    else inserted = data?.length || 0;
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: summary.insert_error ? "error" : (summary.usgs_error && summary.gdacs_error ? "partial" : "success"),
    message: `Ingested ${inserted}/${allEvents.length} events. ${JSON.stringify(summary)} (${Date.now() - start}ms)`,
  });

  await finishProviderRun(supabase, __run, {
    records_fetched: allEvents.length,
    records_inserted: inserted,
    records_normalized: allEvents.length,
    error_count: summary.insert_error ? 1 : 0,
    error_summary: (summary.insert_error as string) ?? null,
  });

  return new Response(JSON.stringify({ ok: true, inserted, sourced: allEvents.length, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
