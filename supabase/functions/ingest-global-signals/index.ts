import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE_SUFFIXES = [
  / - [A-Z][A-Za-z\s.]+$/,
  / \| [A-Z][A-Za-z\s.]+$/,
  / — [A-Z][A-Za-z\s.]+$/,
  /: Live [Uu]pdates?$/,
  / Live [Uu]pdates?$/,
];

const GDELT_QUERIES = [
  "conflict OR war OR ceasefire OR missile OR military",
  "economic crisis OR recession OR inflation OR debt",
  "oil OR gas OR refinery OR diesel OR jet fuel OR LNG OR OPEC",
  "trade OR tariff OR export restriction OR shipping OR port OR supply chain",
  "election OR referendum OR coup OR sanctions OR diplomacy OR summit",
  "outbreak OR epidemic OR vaccine OR WHO OR public health emergency",
  "cyber attack OR ransomware OR breach OR vulnerability OR zero-day",
  "earthquake OR flood OR drought OR wildfire OR storm OR blackout",
  "pirates OR piracy OR hijacked OR tanker OR vessel OR maritime OR Gulf of Aden OR Red Sea OR Strait of Hormuz OR Bab el-Mandeb",
  "ship attack OR boarded OR navy intercept OR Houthi OR UKMTO OR EUNAVFOR OR convoy",
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

function combinedSimilarity(a: { title: string; desc: string }, b: { title: string; desc: string }): number {
  const titleSim = jaccardSimilarity(a.title, b.title);
  const descSim = jaccardSimilarity(a.desc, b.desc);
  return titleSim * 0.7 + descSim * 0.3;
}

const MERGE_THRESHOLD = 0.45;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  geopolitical: ["sanctions","diplomacy","treaty","summit","un","nato","ambassador","territorial","sovereignty","prime minister","president"],
  economic: ["gdp","recession","inflation","unemployment","trade deficit","stimulus","fiscal","economy"],
  financial_markets: ["stock","market","s&p","nasdaq","dow","bonds","rally","crash","ipo","sec"],
  central_banking: ["fed","ecb","interest rate","monetary policy","central bank","rate hike","rate cut","quantitative"],
  public_health: ["who","pandemic","outbreak","vaccine","epidemic","disease","health emergency","covid","bird flu"],
  climate_disaster: ["earthquake","hurricane","flood","wildfire","tsunami","drought","climate","storm","tornado"],
  energy: ["oil","gas","opec","pipeline","renewable","solar","nuclear","energy crisis","power grid","diesel","jet fuel","lng","refinery"],
  technology: ["ai","artificial intelligence","tech","semiconductor","chip","quantum"],
  cybersecurity: ["hack","ransomware","breach","malware","cyber attack","phishing","vulnerability","zero-day"],
  defense_conflict: ["military","war","troops","missile","bombing","ceasefire","invasion","defense","conflict"],
  legal_regulatory: ["regulation","lawsuit","court","ruling","law","antitrust","compliance","gdpr","ban"],
  supply_chain: ["supply chain","shipping","port","logistics","shortage","tariff","import","export","freight","container"],
  elections: ["election","vote","ballot","candidate","polling","referendum","inauguration","campaign"],
  social_unrest: ["protest","riot","demonstration","strike","unrest","civil","march","activist"],
  infrastructure: ["bridge","dam","grid","telecom","internet","rail","airport","infrastructure","blackout","aviation"],
  maritime_security: ["pirate","piracy","hijack","hijacked","tanker","vessel","ship attack","boarded","ukmto","eunavfor","gulf of aden","red sea","strait of hormuz","bab el-mandeb","houthi","navy intercept","convoy","maritime"]
};

function classifyCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  let best = "geopolitical";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(k => text.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

function getTrustTier(weight: number): string {
  if (weight >= 85) return "tier_1";
  if (weight >= 60) return "tier_2";
  return "tier_3";
}

function deriveSourceType(name: string, parserType: string, official: boolean): string {
  if (official) return `official_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  if (parserType === "newsapi") return "newsapi";
  if (parserType === "gdelt") return "gdelt";
  return `feed_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function parseRssItems(xml: string, sourceName: string, sourceType: string, official = false): any[] {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
    const desc = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() || "";
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
    const pubDate = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ||
      block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1]?.trim() || "";
    if (title && title.length > 10) {
      items.push({
        title,
        description: desc || title,
        url: link,
        source: { name: sourceName },
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        _ingestionSource: sourceType,
        _isOfficial: official,
      });
    }
  }
  return items;
}

function parseAtomItems(xml: string, sourceName: string, sourceType: string, official = false): any[] {
  const items: any[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() || "";
    const content = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() || "";
    const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "";
    const updated = block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]?.trim() ||
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]?.trim() || "";
    if (title && title.length > 10) {
      items.push({
        title,
        description: summary || content || title,
        url: link,
        source: { name: sourceName },
        publishedAt: updated ? new Date(updated).toISOString() : new Date().toISOString(),
        _ingestionSource: sourceType,
        _isOfficial: official,
      });
    }
  }
  return items;
}

type RegistrySource = {
  source_name: string;
  source_type: string;
  parser_type: string;
  urls: string[];
  enabled: boolean;
  priority: number;
  official_source: boolean;
  trust_weight: number;
};

async function loadRegistrySources(supabase: any): Promise<RegistrySource[]> {
  const { data, error } = await supabase
    .from("signal_source_registry")
    .select("source_name, source_type, parser_type, urls, enabled, priority, official_source, trust_weight")
    .eq("enabled", true)
    .order("priority", { ascending: true });

  if (error) throw new Error(`Failed to load signal_source_registry: ${error.message}`);
  return (data || []) as RegistrySource[];
}

async function fetchRegistrySources(registrySources: RegistrySource[]): Promise<{ articles: any[]; runs: { name: string; status: string; count: number; error?: string }[] }> {
  const articles: any[] = [];
  const runs: { name: string; status: string; count: number; error?: string }[] = [];

  const results = await Promise.allSettled(
    registrySources.filter(s => s.parser_type !== "newsapi" && s.parser_type !== "gdelt").map(async (source) => {
      const connArticles: any[] = [];
      const sourceType = source.source_type || deriveSourceType(source.source_name, source.parser_type, source.official_source);

      for (const url of source.urls || []) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        try {
          const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { "User-Agent": "AICIS/1.0 Signal Intelligence Platform" },
          });
          if (!res.ok) {
            runs.push({ name: source.source_name, status: "failed", count: 0, error: `HTTP ${res.status}` });
            continue;
          }
          const text = await res.text();
          let items: any[] = [];
          if (source.parser_type === "rss") items = parseRssItems(text, source.source_name, sourceType, source.official_source);
          else if (source.parser_type === "atom") items = parseAtomItems(text, source.source_name, sourceType, source.official_source);
          connArticles.push(...items.slice(0, 12));
        } catch (e) {
          runs.push({ name: source.source_name, status: "failed", count: 0, error: (e as Error).message?.slice(0, 120) });
        } finally {
          clearTimeout(t);
        }
      }

      if (connArticles.length > 0) runs.push({ name: source.source_name, status: "success", count: connArticles.length });
      else if (!runs.find(r => r.name === source.source_name)) runs.push({ name: source.source_name, status: "empty", count: 0 });

      return connArticles;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) articles.push(...r.value);
  }

  return { articles, runs };
}

async function fetchNewsApiArticles(NEWSAPI_KEY: string | undefined): Promise<any[]> {
  if (!NEWSAPI_KEY) return [];

  const queries = [
    "fuel OR diesel OR jet fuel OR refinery",
    "trade OR tariff OR export restriction",
    "prime minister OR president OR bilateral",
    "port OR shipping OR logistics",
  ];

  const categoryResults = await Promise.allSettled(
    ["general", "business", "health", "science", "technology"].map(async (cat) => {
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
      } catch {
        return [];
      } finally {
        clearTimeout(t);
      }
    })
  );

  const everythingResults = await Promise.allSettled(
    queries.map(async (query) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWSAPI_KEY}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.articles || []).map((a: any) => ({ ...a, _ingestionSource: "newsapi_search" }));
      } catch {
        return [];
      } finally {
        clearTimeout(t);
      }
    })
  );

  const all: any[] = [];
  for (const r of [...categoryResults, ...everythingResults]) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  return all;
}

async function fetchGdeltArticles(): Promise<any[]> {
  const articles: any[] = [];
  const results = await Promise.allSettled(
    GDELT_QUERIES.map(async (query) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=12&timespan=6h`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          return (data.articles || []).map((a: any) => ({
            title: a.title || "",
            description: a.seendate ? `${query}: ${a.title || ""}` : `GDELT: ${a.title || ""}`,
            url: a.url || "",
            source: { name: a.domain || "GDELT" },
            publishedAt: a.seendate ? new Date(
              a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z")
            ).toISOString() : new Date().toISOString(),
            _ingestionSource: "gdelt",
          }));
        }
        return [];
      } catch {
        return [];
      } finally {
        clearTimeout(t);
      }
    })
  );

  for (const r of results) if (r.status === "fulfilled") articles.push(...r.value);
  return articles;
}

async function updateBenchmarks(supabase: any) {
  const { data: pendingBenchmarks, error } = await supabase
    .from("signal_detection_benchmarks")
    .select("id, event_title, event_summary, event_occurred_at")
    .in("validation_status", ["pending", "needs_review"])
    .order("event_occurred_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Failed loading benchmarks:", error.message);
    return { detected: 0, missed: 0, total: 0 };
  }

  let detected = 0;
  let missed = 0;

  for (const benchmark of pendingBenchmarks || []) {
    const fromTs = benchmark.event_occurred_at || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: candidates } = await supabase
      .from("global_signals")
      .select("id, title, occurred_at, ingested_at")
      .gte("occurred_at", new Date(new Date(fromTs).getTime() - 24 * 3600 * 1000).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(60);

    let best: any = null;
    let bestScore = 0;
    for (const candidate of candidates || []) {
      const score = combinedSimilarity(
        { title: benchmark.event_title, desc: benchmark.event_summary || "" },
        { title: candidate.title || "", desc: "" }
      );
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best && bestScore >= 0.55) {
      const detectedAt = best.ingested_at || best.occurred_at || new Date().toISOString();
      const latency = benchmark.event_occurred_at
        ? Math.max(0, Math.round((new Date(detectedAt).getTime() - new Date(benchmark.event_occurred_at).getTime()) / 60000))
        : null;

      await supabase.from("signal_detection_benchmarks").update({
        detected: true,
        detected_signal_id: best.id,
        detected_at: detectedAt,
        detection_latency_minutes: latency,
        validation_status: "detected",
        validation_notes: `Matched automatically with similarity ${bestScore.toFixed(2)}`,
      }).eq("id", benchmark.id);
      detected++;
    } else {
      await supabase.from("signal_detection_benchmarks").update({
        detected: false,
        validation_status: "missed",
        validation_notes: "No matching global signal found in automatic benchmark audit",
      }).eq("id", benchmark.id);
      missed++;
    }
  }

  return { detected, missed, total: (pendingBenchmarks || []).length };
}

async function snapshotCoverage(supabase: any, registrySources: RegistrySource[], benchmarkAudit: { detected: number; missed: number; total: number }) {
  const [{ count: totalRuns24h }, { count: failedRuns24h }, { count: newSignals24h }, { data: uniqueRows }, { data: benchmarkSummary }] = await Promise.all([
    supabase.from("source_connector_runs").select("id", { count: "exact", head: true }).gte("run_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    supabase.from("source_connector_runs").select("id", { count: "exact", head: true }).gte("run_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).neq("run_status", "success"),
    supabase.from("global_signals").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    supabase.from("global_signals").select("primary_source").gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    supabase.from("signal_detection_benchmarks").select("detected, detection_latency_minutes, validation_status"),
  ]);

  const uniqueSources24h = new Set((uniqueRows || []).map((row: any) => row.primary_source).filter(Boolean)).size;
  const benchmarks = benchmarkSummary || [];
  const detectedCount = benchmarks.filter((b: any) => b.detected || b.validation_status === "detected").length;
  const missedCount = benchmarks.filter((b: any) => b.validation_status === "missed").length;
  const latencies = benchmarks.map((b: any) => b.detection_latency_minutes).filter((v: any) => typeof v === "number");
  const avgLatency = latencies.length ? Number((latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length).toFixed(2)) : null;

  await supabase.from("signal_coverage_snapshots").upsert({
    snapshot_date: new Date().toISOString().slice(0, 10),
    total_sources: registrySources.length,
    active_sources: registrySources.filter(s => s.enabled).length,
    official_sources: registrySources.filter(s => s.official_source).length,
    total_runs_24h: totalRuns24h || 0,
    failed_runs_24h: failedRuns24h || 0,
    new_signals_24h: newSignals24h || 0,
    unique_sources_24h: uniqueSources24h,
    benchmarks_total: benchmarks.length,
    benchmarks_detected: detectedCount,
    benchmarks_missed: missedCount,
    avg_detection_latency_minutes: avgLatency,
    metadata: {
      benchmark_audit_run: benchmarkAudit,
      generated_at: new Date().toISOString(),
    },
  }, { onConflict: "snapshot_date" });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const intakeStart = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const NEWSAPI_KEY = Deno.env.get("NEWSAPI_KEY");

    const [trustDataRes, registrySources, newsArticles, gdeltArticles] = await Promise.all([
      supabase.from("source_trust_scores").select("source_name, credibility_weight, source_type, verification_level, official_source"),
      loadRegistrySources(supabase),
      fetchNewsApiArticles(NEWSAPI_KEY),
      fetchGdeltArticles(),
    ]);

    const trustData = trustDataRes.data || [];
    const trustMap: Record<string, { weight: number; type: string; level: string; official: boolean }> = {};
    for (const t of trustData) {
      trustMap[t.source_name.toLowerCase()] = {
        weight: t.credibility_weight,
        type: t.source_type,
        level: t.verification_level,
        official: t.official_source ?? false,
      };
    }
    for (const s of registrySources) {
      if (!trustMap[s.source_name.toLowerCase()]) {
        trustMap[s.source_name.toLowerCase()] = {
          weight: s.trust_weight ?? 50,
          type: s.source_type,
          level: s.official_source ? "official" : "registry",
          official: s.official_source ?? false,
        };
      }
    }

    const officialResult = await fetchRegistrySources(registrySources);
    const allArticles: any[] = [...newsArticles, ...gdeltArticles, ...officialResult.articles];
    const newsapiCount = newsArticles.length;

    for (const run of officialResult.runs) {
      await logConnectorRun(supabase, run.name, run.status, run.count, 0, 0, Date.now() - intakeStart, run.error);
    }

    const valid = allArticles.filter(a => a.title && a.title !== "[Removed]" && a.description && a.description !== "[Removed]" && a.url);

    const seen = new Set<string>();
    const kept: any[] = [];

    for (const a of valid) {
      const key = computeDedup(a.title, a.source?.name || "unknown");
      if (seen.has(key)) continue;

      let merged = false;
      for (const k of kept) {
        const sim = combinedSimilarity(
          { title: a.title, desc: a.description || "" },
          { title: k.title, desc: k.description || "" }
        );
        if (sim > MERGE_THRESHOLD) {
          if (!k._mergedSources) k._mergedSources = [];
          k._mergedSources.push({ url: a.url, name: a.source?.name, published: a.publishedAt });
          const existTrust = trustMap[k.source?.name?.toLowerCase()] || { weight: 50, official: false };
          const newTrust = trustMap[a.source?.name?.toLowerCase()] || { weight: 50, official: false };
          if (newTrust.official && !existTrust.official) {
            k._mergedSources.push({ url: k.url, name: k.source?.name, published: k.publishedAt });
            k.title = a.title; k.description = a.description;
            k.url = a.url; k.source = a.source; k.publishedAt = a.publishedAt;
            k._ingestionSource = a._ingestionSource; k._isOfficial = a._isOfficial;
          } else if (newTrust.weight > existTrust.weight + 10) {
            k._mergedSources.push({ url: k.url, name: k.source?.name, published: k.publishedAt });
            k.title = a.title; k.description = a.description;
            k.url = a.url; k.source = a.source; k.publishedAt = a.publishedAt;
            k._ingestionSource = a._ingestionSource; k._isOfficial = a._isOfficial;
          }
          merged = true;
          break;
        }
      }
      if (!merged) { seen.add(key); kept.push(a); }
    }

    const dedupKeys = kept.map(a => computeDedup(a.title, a.source?.name || "unknown"));
    const { data: existing } = await supabase
      .from("global_signals").select("dedup_key, id, title, source_count, source_references")
      .in("dedup_key", dedupKeys);
    const existingKeys = new Set((existing || []).map(e => e.dedup_key));

    const { data: recentSignals } = await supabase
      .from("global_signals").select("id, title, summary, source_count, source_references")
      .order("first_detected_at", { ascending: false }).limit(120);

    const newArticles: any[] = [];
    const updatedSignals: any[] = [];

    for (const a of kept) {
      const key = computeDedup(a.title, a.source?.name || "unknown");
      if (existingKeys.has(key)) continue;

      let matchedExisting = false;
      for (const recent of (recentSignals || [])) {
        const sim = combinedSimilarity(
          { title: a.title, desc: a.description || "" },
          { title: recent.title, desc: (recent as any).summary || "" }
        );
        if (sim > MERGE_THRESHOLD) {
          const newRefs = [...(recent.source_references || []), { url: a.url, name: a.source?.name, published: a.publishedAt }];
          const newCount = (recent.source_count || 1) + 1;
          const isOfficialNew = a._isOfficial || trustMap[a.source?.name?.toLowerCase()]?.official;
          updatedSignals.push({
            id: recent.id,
            source_count: newCount,
            source_references: newRefs,
            multi_source_confirmed: newCount >= 3,
            official_source_present: isOfficialNew || false,
          });
          matchedExisting = true;
          break;
        }
      }
      if (!matchedExisting) newArticles.push(a);
    }

    for (const u of updatedSignals) {
      const update: any = {
        source_count: u.source_count,
        source_references: u.source_references,
        multi_source_confirmed: u.multi_source_confirmed,
      };
      if (u.official_source_present) update.official_source_present = true;
      await supabase.from("global_signals").update(update).eq("id", u.id);
    }

    if (newArticles.length === 0) {
      await logConnectorRun(supabase, "newsapi", "success", newsapiCount, 0, updatedSignals.length, Date.now() - intakeStart);
      if (gdeltArticles.length > 0) await logConnectorRun(supabase, "gdelt", "success", gdeltArticles.length, 0, 0, Date.now() - intakeStart);

      const benchmarkAudit = await updateBenchmarks(supabase);
      await snapshotCoverage(supabase, registrySources, benchmarkAudit);

      return new Response(JSON.stringify({
        ok: true,
        new_signals: 0,
        updated_signals: updatedSignals.length,
        pending_enrichment: 0,
        official_fetched: officialResult.articles.length,
        benchmark_audit: benchmarkAudit,
        message: "No new signals, updated existing",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const signals: any[] = [];
    for (const article of newArticles.slice(0, 80)) {
      const sourceName = article.source?.name || "Unknown";
      const trust = trustMap[sourceName.toLowerCase()];
      const trustWeight = trust?.weight ?? 50;
      const trustTier = getTrustTier(trustWeight);
      const isOfficial = trust?.official ?? article._isOfficial ?? false;
      const category = classifyCategory(article.title, article.description || "");
      const dedupKey = computeDedup(article.title, sourceName);

      const encoder = new TextEncoder();
      const hashData = encoder.encode(`${article.title}|${article.url}|${article.publishedAt}`);
      const hashBuffer = await crypto.subtle.digest("SHA-256", hashData);
      const evidenceHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

      const mergedSources = article._mergedSources || [];
      const allRefs = [{ url: article.url, name: sourceName, published: article.publishedAt }, ...mergedSources];
      const sourceCount = allRefs.length;
      const officialPresent = isOfficial || mergedSources.some((s: any) => trustMap[s.name?.toLowerCase()]?.official);
      const sourceRankScore = trustWeight + (isOfficial ? 20 : 0) + (sourceCount > 1 ? sourceCount * 2 : 0);

      signals.push({
        title: article.title,
        summary: article.description || article.title,
        category,
        status: "new",
        confidence_score: 50,
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
        ingestion_source: article._ingestionSource || "registry_feed",
        dedup_key: dedupKey,
        source_trust_tier: trustTier,
        multi_source_confirmed: sourceCount >= 3,
        related_signal_ids: [],
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
    await logConnectorRun(supabase, "newsapi", "success", newsapiCount, inserted?.length || 0, updatedSignals.length, durationMs);
    if (gdeltArticles.length > 0) await logConnectorRun(supabase, "gdelt", "success", gdeltArticles.length, 0, 0, durationMs);

    const benchmarkAudit = await updateBenchmarks(supabase);
    await snapshotCoverage(supabase, registrySources, benchmarkAudit);

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
        benchmark_audit: benchmarkAudit,
        sources: {
          newsapi: newsapiCount,
          gdelt: gdeltArticles.length,
          official: officialResult.articles.length,
          registry_total: registrySources.length,
          official_connectors: officialResult.runs.filter(r => r.status === "success").length,
          official_failed: officialResult.runs.filter(r => r.status === "failed").length,
        },
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      new_signals: inserted?.length || 0,
      updated_signals: updatedSignals.length,
      pending_enrichment: inserted?.length || 0,
      duration_ms: durationMs,
      benchmark_audit: benchmarkAudit,
      sources: {
        newsapi: newsapiCount,
        gdelt: gdeltArticles.length,
        official: officialResult.articles.length,
        registry_total: registrySources.length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Intake error:", error);
    const errMsg = (error as Error).message || "Unknown intake error";
    return new Response(JSON.stringify({ error: errMsg.slice(0, 500) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logConnectorRun(supabase: any, source: string, status: string, fetched: number, newCount: number, merged: number, durationMs: number, error?: string) {
  try {
    await supabase.from("source_connector_runs").insert({
      source_name: source,
      source_type: source.startsWith("official_") ? "official_feed" : source === "gdelt" ? "aggregator" : "news_api",
      run_status: status,
      signals_fetched: fetched,
      signals_new: newCount,
      signals_merged: merged,
      duration_ms: durationMs,
      ...(error ? { error_message: error } : {}),
    });
  } catch (e) {
    console.error("Failed to log connector run:", e);
  }
}
