import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
/**
 * lril-proxy — Proxy signal anomaly detector for low-signal regions
 *
 * Computes deviations against a 30-day baseline and inserts into
 * aicis_proxy_signals. When a fresh proxy anomaly co-occurs with an
 * active LRIL event in the same locality + window, boosts the event's
 * confidence (capped at 1.0).
 *
 * Accepts POST { readings: [{ iso3, locality, lat, lon, signal_type, value, timestamp? }] }
 * Designed to be called by external satellite/network feeders. Also runs
 * a self-baseline pass: for any proxy without baseline, computes 30-day mean.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "lril-proxy";
const PROXY_BOOST_MAX = 0.2;
const COOCCURRENCE_WINDOW_H = 24;

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  const stats = { ingested: 0, boosted_events: 0, errors: 0 };

  let body: any = {};
  try { body = await req.json(); } catch { /* allow GET-style trigger */ }
  const readings: any[] = Array.isArray(body?.readings) ? body.readings : [];

  // Ingest readings (compute deviation if baseline supplied or computable)
  for (const r of readings) {
    try {
      const iso3 = String(r.iso3 || "").toUpperCase().slice(0, 3);
      if (!iso3 || !r.signal_type || r.value == null) continue;

      // Compute baseline from last 30d if not supplied
      let baseline = r.baseline;
      if (baseline == null) {
        const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
        const { data: hist } = await supabase
          .from("aicis_proxy_signals")
          .select("value")
          .eq("iso3", iso3)
          .eq("signal_type", r.signal_type)
          .ilike("locality", r.locality || "%")
          .gte("timestamp", since)
          .limit(500);
        if (hist && hist.length > 0) {
          baseline = hist.reduce((a, x) => a + Number(x.value), 0) / hist.length;
        }
      }
      const deviation = baseline != null && baseline !== 0
        ? (Number(r.value) - Number(baseline)) / Math.abs(Number(baseline))
        : null;

      const ts = r.timestamp || new Date().toISOString();
      const { error } = await supabase.from("aicis_proxy_signals").insert({
        iso3,
        admin_level_1: r.admin_level_1 || null,
        locality: r.locality || null,
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        signal_type: r.signal_type,
        value: Number(r.value),
        baseline: baseline != null ? Number(baseline) : null,
        deviation,
        timestamp: ts,
        source_name: r.source_name || "external",
        metadata: r.metadata || {},
      });
      if (error) { stats.errors++; continue; }
      stats.ingested++;

      // Boost matching events if deviation is large
      if (deviation != null && Math.abs(deviation) >= 0.4) {
        const windowStart = new Date(new Date(ts).getTime() - COOCCURRENCE_WINDOW_H * 3600 * 1000).toISOString();
        const windowEnd   = new Date(new Date(ts).getTime() + COOCCURRENCE_WINDOW_H * 3600 * 1000).toISOString();

        const q = supabase
          .from("aicis_local_events")
          .select("id, confidence, proxy_boost, locality")
          .eq("iso3", iso3)
          .eq("status", "active")
          .gte("start_time", windowStart)
          .lte("start_time", windowEnd);
        if (r.locality) q.ilike("locality", `%${r.locality}%`);
        const { data: events } = await q.limit(10);

        for (const e of (events || [])) {
          const boost = Math.min(PROXY_BOOST_MAX, Math.abs(deviation) * 0.15);
          const newConfidence = Math.min(1, Number(e.confidence) + boost);
          await supabase.from("aicis_local_events").update({
            confidence: newConfidence,
            proxy_boost: boost,
            bridged_to_normalized: false,
          }).eq("id", e.id);
          stats.boosted_events++;
        }
      }
    } catch (e) {
      stats.errors++;
      console.error("proxy reading", (e as Error).message);
    }
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: stats.errors > 0 ? "partial" : "success",
    message: `${JSON.stringify(stats)} (${Date.now() - start}ms)`,
  });

  return new Response(JSON.stringify({ ok: true, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
