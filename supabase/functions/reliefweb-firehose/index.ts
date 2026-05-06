/**
 * reliefweb-firehose — pulls the ReliefWeb (UN OCHA) updates API and
 * ingests humanitarian disasters/crises into global_signals.
 *
 * Free, no key. https://reliefweb.int/help/api
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "reliefweb-firehose";

function normalizeDedup(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ");
}
async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pull latest 100 updates worldwide
  const url = "https://api.reliefweb.int/v1/reports?appname=aicis&profile=full&limit=100&sort[]=date.created:desc";
  const res = await fetch(url);
  if (!res.ok) {
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: `HTTP ${res.status}` });
    return new Response(JSON.stringify({ error: "reliefweb HTTP " + res.status }), { status: 500, headers: corsHeaders });
  }
  const j = await res.json();
  const items = (j?.data ?? []) as any[];

  const candidates: any[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const f = it?.fields ?? {};
    const title = f.title;
    if (!title) continue;
    const domain = "reliefweb.int";
    const dedup = `${normalizeDedup(title)}::${domain}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const iso3s: string[] = [];
    for (const c of (f.country ?? [])) {
      if (c?.iso3) iso3s.push(c.iso3.toUpperCase());
    }
    const occurredAt = f.date?.created ?? new Date().toISOString();
    const link = f.url ?? `https://reliefweb.int/report/${it.id}`;

    let category = "migration_displacement";
    const t = (title + " " + (f.body_html ?? "")).toLowerCase();
    if (t.includes("flood") || t.includes("storm") || t.includes("earthquake") || t.includes("cyclone")) category = "climate_disaster";
    else if (t.includes("conflict") || t.includes("violence") || t.includes("attack")) category = "defense_conflict";
    else if (t.includes("cholera") || t.includes("outbreak") || t.includes("epidemic")) category = "public_health";
    else if (t.includes("food") || t.includes("famine") || t.includes("hunger")) category = "food_agriculture";

    candidates.push({ title, link, domain, occurredAt, iso3s, category, dedup });
  }

  let existing = new Set<string>();
  if (candidates.length > 0) {
    const { data } = await supabase
      .from("global_signals").select("dedup_key").in("dedup_key", candidates.map(c => c.dedup));
    existing = new Set((data ?? []).map((r: any) => r.dedup_key));
  }

  const toInsert: any[] = [];
  const nowMs = Date.now();
  for (const c of candidates) {
    if (existing.has(c.dedup)) continue;
    const detectionLatencySec = Math.max(0, Math.round((nowMs - new Date(c.occurredAt).getTime()) / 1000));
    const evidenceHash = await sha256Hex(`${c.title}|${c.link}|${c.occurredAt}`);
    toInsert.push({
      detection_latency_seconds: detectionLatencySec,
      last_pipeline_stage: "ingested",
      title: c.title.slice(0, 500),
      summary: c.title.slice(0, 2000),
      category: c.category,
      status: "new",
      confidence_score: 75,
      impact_score: 65,
      urgency_score: 70,
      source_count: 1,
      primary_source: "ReliefWeb",
      source_references: [{ url: c.link, name: "ReliefWeb (UN OCHA)", published: c.occurredAt }],
      first_detected_at: c.occurredAt,
      latest_update_at: new Date().toISOString(),
      occurred_at: c.occurredAt,
      affected_regions: [],
      affected_countries: c.iso3s,
      affected_sectors: ["humanitarian"],
      affected_stakeholders: ["humanitarian-agencies"],
      evidence_hash: evidenceHash,
      ingestion_source: "reliefweb_firehose",
      dedup_key: c.dedup,
      source_trust_tier: "tier_1",
      multi_source_confirmed: false,
      related_signal_ids: [],
      enrichment_status: "pending_enrichment",
      enrichment_attempts: 0,
      ingested_at: new Date().toISOString(),
      official_source: true,
      official_source_present: true,
      canonical_source_name: "ReliefWeb",
      source_rank_score: 90,
      merged_source_count: 1,
    });
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase.from("global_signals").insert(toInsert).select("id");
    if (error) console.error("reliefweb insert", error.message);
    else inserted = data?.length ?? 0;
  }

  const dur = Date.now() - start;
  await supabase.from("automation_logs").insert({
    job_name: FN, status: "success",
    message: `raw=${items.length} unique=${candidates.length} new=${inserted} dur=${dur}ms`,
  });
  return new Response(JSON.stringify({ ok: true, raw: items.length, unique: candidates.length, inserted, duration_ms: dur }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
