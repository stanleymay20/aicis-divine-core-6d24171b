/**
 * web-search-sweep — Firecrawl-powered planetary web search.
 *
 * Pulls active rolling queries from `web_search_sweep_queries`, calls
 * Firecrawl Search for each, normalizes hits, and pipes them straight into
 * `global_signals` with proper dedup. Designed to catch anything that's
 * trending on the open web that pre-registered RSS feeds don't carry.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "web-search-sweep";
const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  geopolitical: ["sanctions", "diplomacy", "treaty", "summit", "ambassador"],
  economic: ["gdp", "recession", "inflation", "unemployment", "stimulus"],
  financial_markets: ["stock", "market", "bonds", "rally", "crash"],
  central_banking: ["fed", "ecb", "interest rate", "monetary policy"],
  public_health: ["who", "pandemic", "outbreak", "vaccine", "epidemic"],
  climate_disaster: ["earthquake", "hurricane", "flood", "wildfire", "storm"],
  energy: ["oil", "gas", "opec", "pipeline", "diesel", "lng", "refinery"],
  cybersecurity: ["hack", "ransomware", "breach", "malware"],
  defense_conflict: ["military", "war", "missile", "ceasefire"],
  supply_chain: ["supply chain", "shipping", "port", "shortage", "tariff"],
  elections: ["election", "vote", "ballot", "referendum"],
  social_unrest: ["protest", "riot", "demonstration", "strike", "unrest"],
  infrastructure: ["bridge", "grid", "rail", "blackout"],
  food_agriculture: ["food", "grain", "famine", "harvest"],
  migration_displacement: ["refugee", "migrant", "displaced"],
  maritime_security: ["pirate", "hijack", "tanker", "houthi", "ukmto"],
  legal_regulatory: ["court", "ruling", "lawsuit", "regulation"],
  technology: ["ai", "semiconductor", "chip"],
};

function normalizeForDedup(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function dedupKey(title: string, source: string) {
  return `${normalizeForDedup(title).split(" ").slice(0, 8).join(" ")}::${source}`;
}
function classify(title: string, desc: string, fallback: string) {
  const text = `${title} ${desc}`.toLowerCase();
  let best = fallback, score = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const s = kws.filter(k => text.includes(k)).length;
    if (s > score) { score = s; best = cat; }
  }
  return best;
}
function domainOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
}

interface SweepQuery {
  id: string;
  query: string;
  category: string;
  time_filter: string;
  result_limit: number;
  priority: number;
}

interface FirecrawlHit {
  url: string;
  title?: string;
  description?: string;
  publishedDate?: string;
}

async function firecrawlSearch(apiKey: string, q: SweepQuery): Promise<FirecrawlHit[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        query: q.query,
        limit: q.result_limit ?? 8,
        tbs: q.time_filter ?? "qdr:d",
        sources: ["news", "web"],
      }),
    });
    if (!res.ok) {
      console.error(`firecrawl ${q.query}: HTTP ${res.status}`);
      return [];
    }
    const j = await res.json();
    // v2 returns either { data: { news: [...], web: [...] } } or { web: [...] }
    const newsHits = j?.data?.news ?? j?.news ?? [];
    const webHits = j?.data?.web ?? j?.web ?? [];
    const arr = [...newsHits, ...webHits];
    return arr.map((h: any) => ({
      url: h.url || h.link || "",
      title: h.title || h.name || "",
      description: h.description || h.snippet || h.markdown || "",
      publishedDate: h.publishedDate || h.date || h.published_at || undefined,
    })).filter((h) => h.url && h.title && h.title.length > 10);
  } catch (e) {
    console.error(`firecrawl error for "${q.query}":`, (e as Error).message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!apiKey) {
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "error", message: "FIRECRAWL_API_KEY missing",
    });
    return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Parse optional cap from body
  let maxQueries = 12;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.max_queries) maxQueries = Math.min(30, Math.max(1, Number(body.max_queries)));
  } catch { /* ignore */ }

  const { data: queries, error: qErr } = await supabase
    .from("web_search_sweep_queries")
    .select("id, query, category, time_filter, result_limit, priority")
    .eq("enabled", true)
    .order("priority", { ascending: true })
    .limit(maxQueries);

  if (qErr) {
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "error", message: qErr.message.slice(0, 400),
    });
    return new Response(JSON.stringify({ error: qErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const allHits: { hit: FirecrawlHit; q: SweepQuery }[] = [];
  let totalRaw = 0;
  const querySummary: Record<string, number> = {};

  for (const q of (queries || []) as SweepQuery[]) {
    const hits = await firecrawlSearch(apiKey, q);
    totalRaw += hits.length;
    querySummary[q.query] = hits.length;
    for (const h of hits) allHits.push({ hit: h, q });
    // gentle throttle
    await new Promise(r => setTimeout(r, 200));
  }

  // Local dedup
  const seen = new Set<string>();
  const candidates: any[] = [];
  for (const { hit, q } of allHits) {
    const src = domainOf(hit.url);
    const k = dedupKey(hit.title!, src);
    if (seen.has(k)) continue;
    seen.add(k);
    const category = classify(hit.title!, hit.description || "", q.category);
    candidates.push({ hit, q, src, k, category });
  }

  // DB-side dedup
  const keys = candidates.map(c => c.k);
  let existing: Set<string> = new Set();
  if (keys.length > 0) {
    const { data: ex } = await supabase
      .from("global_signals")
      .select("dedup_key")
      .in("dedup_key", keys);
    existing = new Set((ex || []).map((r: any) => r.dedup_key));
  }

  const toInsert: any[] = [];
  for (const c of candidates) {
    if (existing.has(c.k)) continue;
    const occurredAt = c.hit.publishedDate
      ? new Date(c.hit.publishedDate).toISOString()
      : new Date().toISOString();
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest("SHA-256",
      enc.encode(`${c.hit.title}|${c.hit.url}|${occurredAt}`));
    const evidenceHash = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    toInsert.push({
      title: c.hit.title.slice(0, 500),
      summary: (c.hit.description || c.hit.title).slice(0, 2000),
      category: c.category,
      status: "new",
      confidence_score: 50,
      impact_score: 45,
      urgency_score: 50,
      source_count: 1,
      primary_source: c.src,
      source_references: [{ url: c.hit.url, name: c.src, published: occurredAt, query: c.q.query }],
      first_detected_at: occurredAt,
      latest_update_at: new Date().toISOString(),
      occurred_at: occurredAt,
      affected_regions: [],
      affected_countries: [],
      affected_sectors: [],
      affected_stakeholders: [],
      evidence_hash: evidenceHash,
      ingestion_source: "firecrawl_search",
      dedup_key: c.k,
      source_trust_tier: "tier_3",
      multi_source_confirmed: false,
      related_signal_ids: [],
      enrichment_status: "pending_enrichment",
      enrichment_attempts: 0,
      ingested_at: new Date().toISOString(),
      official_source: false,
      official_source_present: false,
      canonical_source_name: c.src,
      source_rank_score: 50,
      merged_source_count: 1,
    });
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("global_signals").insert(toInsert).select("id");
    if (error) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "partial",
        message: `Insert failed: ${error.message.slice(0, 300)} | candidates=${toInsert.length}`,
      });
    } else {
      inserted = data?.length || 0;
    }
  }

  const dur = Date.now() - start;
  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: "success",
    message: `queries=${queries?.length || 0} raw=${totalRaw} unique=${candidates.length} new=${inserted} dur=${dur}ms`,
  });

  return new Response(JSON.stringify({
    ok: true,
    queries_run: queries?.length || 0,
    raw_hits: totalRaw,
    unique_candidates: candidates.length,
    inserted,
    duration_ms: dur,
    per_query: querySummary,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
