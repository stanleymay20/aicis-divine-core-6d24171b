/**
 * usgs-quake-firehose — pulls USGS significant + M4.5+ earthquakes from the past hour.
 * Free, no key. https://earthquake.usgs.gov/earthquakes/feed/
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "usgs-quake-firehose";

// Approx country bbox -> iso3 reverse lookup (cheap; for precision we'd add a polygon service)
// Here we just attach country if USGS gives us a place hint we can match later.
async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function normalizeDedup(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Past day, M4.5+ — runs every 30min, dedup handles overlap
  const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
  const res = await fetch(url);
  if (!res.ok) {
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: `HTTP ${res.status}` });
    return new Response(JSON.stringify({ error: "usgs HTTP " + res.status }), { status: 500, headers: corsHeaders });
  }
  const j = await res.json();
  const features = (j?.features ?? []) as any[];

  const candidates: any[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = f?.properties ?? {};
    const place = p.place || "Unknown location";
    const mag = p.mag;
    const time = p.time ? new Date(p.time).toISOString() : new Date().toISOString();
    const id = f.id;
    const url = p.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
    const title = `M${mag?.toFixed(1)} earthquake — ${place}`;
    const dedup = `${normalizeDedup(title)}::usgs.gov`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    candidates.push({ title, url, time, mag, place, dedup });
  }

  let existing = new Set<string>();
  if (candidates.length > 0) {
    const { data } = await supabase
      .from("global_signals").select("dedup_key").in("dedup_key", candidates.map(c => c.dedup));
    existing = new Set((data ?? []).map((r: any) => r.dedup_key));
  }

  const toInsert: any[] = [];
  for (const c of candidates) {
    if (existing.has(c.dedup)) continue;
    const evidenceHash = await sha256Hex(`${c.title}|${c.url}|${c.time}`);
    const impact = c.mag >= 7 ? 95 : c.mag >= 6 ? 80 : c.mag >= 5 ? 60 : 45;
    const urgency = c.mag >= 6 ? 90 : 65;
    toInsert.push({
      title: c.title.slice(0, 500),
      summary: `Magnitude ${c.mag} earthquake near ${c.place}.`.slice(0, 2000),
      category: "climate_disaster",
      subcategory: "earthquake",
      status: "new",
      confidence_score: 99,
      impact_score: impact,
      urgency_score: urgency,
      source_count: 1,
      primary_source: "USGS",
      source_references: [{ url: c.url, name: "USGS", published: c.time, magnitude: c.mag }],
      first_detected_at: c.time,
      latest_update_at: new Date().toISOString(),
      occurred_at: c.time,
      affected_regions: [],
      affected_countries: [],
      affected_sectors: ["disaster-response"],
      affected_stakeholders: [],
      evidence_hash: evidenceHash,
      ingestion_source: "usgs_firehose",
      dedup_key: c.dedup,
      source_trust_tier: "tier_1",
      multi_source_confirmed: true,
      related_signal_ids: [],
      enrichment_status: "pending_enrichment",
      enrichment_attempts: 0,
      ingested_at: new Date().toISOString(),
      official_source: true,
      official_source_present: true,
      canonical_source_name: "USGS",
      source_rank_score: 100,
      merged_source_count: 1,
    });
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase.from("global_signals").insert(toInsert).select("id");
    if (error) console.error("usgs insert", error.message);
    else inserted = data?.length ?? 0;
  }

  const dur = Date.now() - start;
  await supabase.from("automation_logs").insert({
    job_name: FN, status: "success",
    message: `quakes=${features.length} unique=${candidates.length} new=${inserted} dur=${dur}ms`,
  });
  return new Response(JSON.stringify({ ok: true, quakes: features.length, inserted, duration_ms: dur }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
