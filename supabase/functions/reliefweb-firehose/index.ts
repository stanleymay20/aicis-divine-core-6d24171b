/**
 * reliefweb-firehose — pulls the ReliefWeb (UN OCHA) reports API and
 * ingests humanitarian disasters/crises into global_signals.
 *
 * Free, no key. https://reliefweb.int/help/api
 *
 * Phase 4.1 fix: GET querystring with `profile=full` returned HTTP 410.
 * Switched to POST with JSON body which is the documented v1 contract and
 * narrowed `fields.include` so the response stays small + reliable.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordFirehoseHealth } from "../_shared/firehose-health.ts";

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

  // POST + JSON body is the canonical contract. The legacy GET with
  // profile=full now returns 410 Gone for unauthenticated callers.
  const url = "https://api.reliefweb.int/v1/reports?appname=aicis-firehose";
  const body = {
    limit: 100,
    sort: ["date.created:desc"],
    fields: {
      include: ["title", "url", "date.created", "country.iso3", "country.name", "primary_country.iso3"],
    },
  };

  let items: any[] = [];
  let httpStatus = 0;
  let errMsg: string | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    httpStatus = res.status;
    if (!res.ok) {
      errMsg = `HTTP ${res.status}`;
      const text = await res.text().catch(() => "");
      console.error("reliefweb http error", res.status, text.slice(0, 200));
    } else {
      const j = await res.json();
      items = (j?.data ?? []) as any[];
    }
  } catch (e) {
    errMsg = (e as Error).message;
    console.error("reliefweb fetch failed", errMsg);
  }

  if (errMsg) {
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: errMsg });
    await recordFirehoseHealth(supabase, {
      name: FN, trustTier: "tier_1", success: false, errorMessage: errMsg, durationMs: Date.now() - start,
    });
    return new Response(JSON.stringify({ error: errMsg, http_status: httpStatus }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
    if (f.primary_country?.iso3 && !iso3s.includes(f.primary_country.iso3.toUpperCase())) {
      iso3s.unshift(f.primary_country.iso3.toUpperCase());
    }
    const occurredAt = f.date?.created ?? new Date().toISOString();
    const link = f.url ?? `https://reliefweb.int/report/${it.id}`;

    let category = "migration_displacement";
    const t = title.toLowerCase();
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
  let insertErr: string | null = null;
  if (toInsert.length > 0) {
    const { data, error } = await supabase.from("global_signals").insert(toInsert).select("id");
    if (error) { insertErr = error.message; console.error("reliefweb insert", error.message); }
    else inserted = data?.length ?? 0;
  }

  const dur = Date.now() - start;
  await supabase.from("automation_logs").insert({
    job_name: FN, status: insertErr ? "error" : "success",
    message: `raw=${items.length} unique=${candidates.length} new=${inserted} dur=${dur}ms${insertErr ? " err=" + insertErr : ""}`,
  });
  await recordFirehoseHealth(supabase, {
    name: FN, trustTier: "tier_1",
    success: !insertErr,
    insertedCount: inserted, durationMs: dur,
    errorMessage: insertErr ?? undefined,
  });

  return new Response(JSON.stringify({ ok: !insertErr, raw: items.length, unique: candidates.length, inserted, duration_ms: dur }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
