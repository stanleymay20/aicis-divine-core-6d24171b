import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- Source suffix cleanup for dedup ----------
const SOURCE_SUFFIXES = [
  / - [A-Z][A-Za-z\s.]+$/,
  / \| [A-Z][A-Za-z\s.]+$/,
  / — [A-Z][A-Za-z\s.]+$/,
  /: Live [Uu]pdates?$/,
  / Live [Uu]pdates?$/,
];

function stripSourceSuffix(title: string): string {
  let cleaned = title;
  for (const p of SOURCE_SUFFIXES) cleaned = cleaned.replace(p, "");
  return cleaned.trim();
}

function normalizeForDedup(title: string): string {
  return stripSourceSuffix(title).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function computeDedup(title: string, source: string): string {
  return `${normalizeForDedup(title).split(" ").slice(0, 8).join(" ")}::${source}`;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeForDedup(a).split(" "));
  const setB = new Set(normalizeForDedup(b).split(" "));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ---------- Simple keyword classifier (fast, no AI) ----------
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  geopolitical: ["sanctions","diplomacy","treaty","summit","UN","NATO","ambassador","territorial","sovereignty"],
  economic: ["GDP","recession","inflation","unemployment","trade deficit","stimulus","fiscal"],
  financial_markets: ["stock","market","S&P","Nasdaq","Dow","bonds","rally","crash","IPO","SEC"],
  central_banking: ["Fed","ECB","interest rate","monetary policy","central bank","rate hike","rate cut","quantitative"],
  public_health: ["WHO","pandemic","outbreak","vaccine","epidemic","disease","health emergency","COVID","bird flu"],
  climate_disaster: ["earthquake","hurricane","flood","wildfire","tsunami","drought","climate","storm","tornado"],
  energy: ["oil","gas","OPEC","pipeline","renewable","solar","nuclear","energy crisis","power grid"],
  technology: ["AI","artificial intelligence","tech","semiconductor","chip","quantum"],
  cybersecurity: ["hack","ransomware","breach","malware","cyber attack","phishing","vulnerability","zero-day"],
  defense_conflict: ["military","war","troops","missile","bombing","ceasefire","invasion","defense","conflict"],
  legal_regulatory: ["regulation","lawsuit","court","ruling","law","antitrust","compliance","GDPR","ban"],
  supply_chain: ["supply chain","shipping","port","logistics","shortage","tariff","import","export"],
  elections: ["election","vote","ballot","candidate","polling","referendum","inauguration","campaign"],
  social_unrest: ["protest","riot","demonstration","strike","unrest","civil","march","activist"],
  infrastructure: ["bridge","dam","grid","telecom","internet","rail","airport","infrastructure","blackout"],
};

function classifyCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  let best = "geopolitical";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(k => text.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

function getTrustTier(weight: number): string {
  if (weight >= 85) return "tier_1";
  if (weight >= 60) return "tier_2";
  return "tier_3";
}

// ---------- GDELT fetch ----------
async function fetchGdeltArticles(): Promise<any[]> {
  const queries = ["conflict OR war", "economic crisis OR recession"];
  const articles: any[] = [];
  const results = await Promise.allSettled(
    queries.map(async (query) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=5&timespan=2h`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          return (data.articles || []).map((a: any) => ({
            title: a.title || "",
            description: `GDELT: ${a.title || ""}`,
            url: a.url || "",
            source: { name: a.domain || "GDELT" },
            publishedAt: a.seendate ? new Date(
              a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z")
            ).toISOString() : new Date().toISOString(),
            _ingestionSource: "gdelt",
          }));
        }
        return [];
      } catch { return []; }
      finally { clearTimeout(t); }
    })
  );
  for (const r of results) if (r.status === "fulfilled") articles.push(...r.value);
  return articles;
}

// ==================== STAGE 1: FAST INTAKE ====================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const intakeStart = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const NEWSAPI_KEY = Deno.env.get("NEWSAPI_KEY");
    if (!NEWSAPI_KEY) throw new Error("NEWSAPI_KEY not configured");

    // Load trust scores
    const { data: trustData } = await supabase
      .from("source_trust_scores")
      .select("source_name, credibility_weight, source_type, verification_level, official_source");
    const trustMap: Record<string, { weight: number; type: string; level: string; official: boolean }> = {};
    for (const t of (trustData || [])) {
      trustMap[t.source_name.toLowerCase()] = {
        weight: t.credibility_weight, type: t.source_type,
        level: t.verification_level, official: t.official_source ?? false,
      };
    }

    // Fetch NewsAPI (fast, parallel categories)
    const categories = ["general", "business", "health", "science", "technology"];
    const newsResults = await Promise.allSettled(
      categories.map(async (cat) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(
            `https://newsapi.org/v2/top-headlines?category=${cat}&language=en&pageSize=10&apiKey=${NEWSAPI_KEY}`,
            { signal: ctrl.signal }
          );
          if (!res.ok) return [];
          const data = await res.json();
          return (data.articles || []).map((a: any) => ({ ...a, _ingestionSource: "newsapi" }));
        } catch { return []; }
        finally { clearTimeout(t); }
      })
    );

    const allArticles: any[] = [];
    for (const r of newsResults) if (r.status === "fulfilled") allArticles.push(...r.value);

    // Fetch GDELT
    const gdeltArticles = await fetchGdeltArticles();
    allArticles.push(...gdeltArticles);

    const newsapiCount = allArticles.length - gdeltArticles.length;

    // Filter junk
    const valid = allArticles.filter(a =>
      a.title && a.title !== "[Removed]" && a.description && a.description !== "[Removed]" && a.url
    );

    // Dedup: exact key + Jaccard similarity with source preference merge
    const seen = new Set<string>();
    const kept: any[] = [];

    for (const a of valid) {
      const key = computeDedup(a.title, a.source?.name || "unknown");
      if (seen.has(key)) continue;

      let merged = false;
      for (const k of kept) {
        if (jaccardSimilarity(a.title, k.title) > 0.6) {
          if (!k._mergedSources) k._mergedSources = [];
          k._mergedSources.push({ url: a.url, name: a.source?.name, published: a.publishedAt });
          // Prefer stronger source as canonical
          const existTrust = trustMap[k.source?.name?.toLowerCase()] || { weight: 50, official: false };
          const newTrust = trustMap[a.source?.name?.toLowerCase()] || { weight: 50, official: false };
          if (newTrust.weight > existTrust.weight || (newTrust.official && !existTrust.official)) {
            // Swap: new source becomes canonical, old becomes merged
            k._mergedSources.push({ url: k.url, name: k.source?.name, published: k.publishedAt });
            k.title = a.title;
            k.description = a.description;
            k.url = a.url;
            k.source = a.source;
            k.publishedAt = a.publishedAt;
            k._ingestionSource = a._ingestionSource;
          }
          merged = true;
          break;
        }
      }
      if (!merged) { seen.add(key); kept.push(a); }
    }

    // Check existing signals in DB for semantic dedup
    const dedupKeys = kept.map(a => computeDedup(a.title, a.source?.name || "unknown"));
    const { data: existing } = await supabase
      .from("global_signals").select("dedup_key, id, title, source_count, source_references")
      .in("dedup_key", dedupKeys);
    const existingKeys = new Set((existing || []).map(e => e.dedup_key));

    const { data: recentSignals } = await supabase
      .from("global_signals").select("id, title, source_count, source_references")
      .order("first_detected_at", { ascending: false }).limit(50);

    const newArticles: any[] = [];
    const updatedSignals: any[] = [];

    for (const a of kept) {
      const key = computeDedup(a.title, a.source?.name || "unknown");
      if (existingKeys.has(key)) continue;

      let matchedExisting = false;
      for (const recent of (recentSignals || [])) {
        if (jaccardSimilarity(a.title, recent.title) > 0.6) {
          const newRefs = [...(recent.source_references || []),
            { url: a.url, name: a.source?.name, published: a.publishedAt }];
          const newCount = (recent.source_count || 1) + 1;
          updatedSignals.push({ id: recent.id, source_count: newCount, source_references: newRefs, multi_source_confirmed: newCount >= 3 });
          matchedExisting = true;
          break;
        }
      }
      if (!matchedExisting) newArticles.push(a);
    }

    // Update existing signals with new source confirmations
    for (const u of updatedSignals) {
      await supabase.from("global_signals").update({
        source_count: u.source_count, source_references: u.source_references as any,
        multi_source_confirmed: u.multi_source_confirmed,
      }).eq("id", u.id);
    }

    if (newArticles.length === 0) {
      // Log connector run
      await logConnectorRun(supabase, "newsapi", "success", newsapiCount, 0, 0, Date.now() - intakeStart);
      if (gdeltArticles.length > 0)
        await logConnectorRun(supabase, "gdelt", "success", gdeltArticles.length, 0, 0, Date.now() - intakeStart);

      return new Response(JSON.stringify({
        ok: true, new_signals: 0, updated_signals: updatedSignals.length, pending_enrichment: 0,
        message: "No new signals, updated existing",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build raw signal objects — FAST, NO AI — status = pending_enrichment
    const signals: any[] = [];
    for (const article of newArticles.slice(0, 20)) {
      const sourceName = article.source?.name || "Unknown";
      const trust = trustMap[sourceName.toLowerCase()];
      const trustWeight = trust?.weight ?? 50;
      const trustTier = getTrustTier(trustWeight);
      const isOfficial = trust?.official ?? false;

      const category = classifyCategory(article.title, article.description || "");
      const dedupKey = computeDedup(article.title, sourceName);

      // Evidence hash
      const encoder = new TextEncoder();
      const hashData = encoder.encode(`${article.title}|${article.url}|${article.publishedAt}`);
      const hashBuffer = await crypto.subtle.digest("SHA-256", hashData);
      const evidenceHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

      const mergedSources = article._mergedSources || [];
      const allRefs = [{ url: article.url, name: sourceName, published: article.publishedAt }, ...mergedSources];
      const sourceCount = allRefs.length;
      const officialPresent = isOfficial || mergedSources.some((s: any) => trustMap[s.name?.toLowerCase()]?.official);

      // Source rank score: higher = better source
      const sourceRankScore = trustWeight + (isOfficial ? 20 : 0) + (sourceCount > 1 ? sourceCount * 2 : 0);

      signals.push({
        title: article.title,
        summary: article.description || article.title,
        category,
        status: "new",
        confidence_score: 50, // placeholder, enrichment will set real values
        impact_score: 40,
        urgency_score: 40,
        source_count: sourceCount,
        primary_source: sourceName,
        source_references: allRefs,
        first_detected_at: article.publishedAt || new Date().toISOString(),
        latest_update_at: new Date().toISOString(),
        occurred_at: article.publishedAt || null,
        affected_regions: [],
        affected_countries: [],
        affected_sectors: [],
        affected_stakeholders: [],
        evidence_hash: evidenceHash,
        ingestion_source: article._ingestionSource || "newsapi",
        dedup_key: dedupKey,
        source_trust_tier: trustTier,
        multi_source_confirmed: sourceCount >= 3,
        related_signal_ids: [],
        // New Phase 16.2 fields
        enrichment_status: "pending_enrichment",
        enrichment_attempts: 0,
        ingested_at: new Date().toISOString(),
        official_source: isOfficial,
        official_source_present: officialPresent,
        canonical_source_name: sourceName,
        source_rank_score: sourceRankScore,
        merged_source_count: sourceCount,
      });
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("global_signals").insert(signals).select("id, title, impact_score, category");

    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    const durationMs = Date.now() - intakeStart;

    // Log connector runs
    await logConnectorRun(supabase, "newsapi", "success", newsapiCount, inserted?.length || 0, updatedSignals.length, durationMs);
    if (gdeltArticles.length > 0)
      await logConnectorRun(supabase, "gdelt", "success", gdeltArticles.length, 0, 0, durationMs);

    // Audit log
    await supabase.from("audit_log").insert({
      action: "global_signal_fast_intake",
      resource_type: "global_signals",
      severity: "info",
      metadata: {
        articles_fetched: allArticles.length,
        unique_after_dedup: newArticles.length,
        signals_created: inserted?.length || 0,
        signals_updated: updatedSignals.length,
        pending_enrichment: inserted?.length || 0,
        duration_ms: durationMs,
        sources: { newsapi: newsapiCount, gdelt: gdeltArticles.length },
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      new_signals: inserted?.length || 0,
      updated_signals: updatedSignals.length,
      pending_enrichment: inserted?.length || 0,
      duration_ms: durationMs,
      sources: { newsapi: newsapiCount, gdelt: gdeltArticles.length },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Intake error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logConnectorRun(supabase: any, source: string, status: string, fetched: number, newCount: number, merged: number, durationMs: number) {
  try {
    await supabase.from("source_connector_runs").insert({
      source_name: source, source_type: source === "gdelt" ? "aggregator" : "news_api",
      run_status: status, signals_fetched: fetched, signals_new: newCount,
      signals_merged: merged, duration_ms: durationMs,
    });
  } catch (e) { console.error("Failed to log connector run:", e); }
}
