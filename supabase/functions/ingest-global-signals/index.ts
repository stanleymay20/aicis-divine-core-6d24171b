import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startProviderRun,
  finishProviderRun,
  failProviderRun,
} from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  geopolitical: ["sanctions", "diplomacy", "treaty", "summit", "un", "nato", "ambassador", "territorial", "sovereignty", "prime minister", "president"],
  economic: ["gdp", "recession", "inflation", "unemployment", "trade deficit", "stimulus", "fiscal", "economy"],
  financial_markets: ["stock", "market", "s&p", "nasdaq", "dow", "bonds", "rally", "crash", "ipo", "sec"],
  central_banking: ["fed", "ecb", "interest rate", "monetary policy", "central bank", "rate hike", "rate cut", "quantitative"],
  public_health: ["who", "pandemic", "outbreak", "vaccine", "epidemic", "disease", "health emergency", "covid", "bird flu"],
  climate_disaster: ["earthquake", "hurricane", "flood", "wildfire", "tsunami", "drought", "climate", "storm", "tornado"],
  energy: ["oil", "gas", "opec", "pipeline", "renewable", "solar", "nuclear", "energy crisis", "power grid", "diesel", "jet fuel", "lng", "refinery"],
  technology: ["ai", "artificial intelligence", "tech", "semiconductor", "chip", "quantum"],
  cybersecurity: ["hack", "ransomware", "breach", "malware", "cyber attack", "phishing", "vulnerability", "zero-day"],
  defense_conflict: ["military", "war", "troops", "missile", "bombing", "ceasefire", "invasion", "defense", "conflict"],
  legal_regulatory: ["regulation", "lawsuit", "court", "ruling", "law", "antitrust", "compliance", "gdpr", "ban"],
  supply_chain: ["supply chain", "shipping", "port", "logistics", "shortage", "tariff", "import", "export", "freight", "container"],
  elections: ["election", "vote", "ballot", "candidate", "polling", "referendum", "inauguration", "campaign"],
  social_unrest: ["protest", "riot", "demonstration", "strike", "unrest", "civil", "march", "activist"],
  infrastructure: ["bridge", "dam", "grid", "telecom", "internet", "rail", "airport", "infrastructure", "blackout", "aviation"],
  maritime_security: ["pirate", "piracy", "hijack", "hijacked", "tanker", "vessel", "ship attack", "boarded", "ukmto", "eunavfor", "gulf of aden", "red sea", "strait of hormuz", "bab el-mandeb", "houthi", "navy intercept", "convoy", "maritime"],
};

type RegistrySource = {
  source_name: string;
  source_type: string;
  parser_type: string;
  urls: string[];
  enabled: boolean;
  priority: number;
  official_source: boolean;
  trust_weight: number | null;
};

type Article = {
  title: string;
  description: string;
  url: string;
  source: { name: string };
  publishedAt: string | null;
  _ingestionSource: string;
  _isOfficial?: boolean;
};

type ConnectorRun = {
  name: string;
  status: string;
  count: number;
  error?: string;
};

type BenchmarkAudit = {
  detected: number;
  missed: number;
  total: number;
  review_candidates?: number;
  skipped?: boolean;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeIso(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function recordKey(article: Article): string {
  const source = normalizeText(article.source.name || "unknown");
  if (article.url) return `url::${source}::${article.url.trim()}`;
  return `title::${source}::${normalizeText(article.title)}::${article.publishedAt ?? "time-unknown"}`;
}

function jaccardSimilarity(left: string, right: string): number {
  const leftSet = new Set(normalizeText(left).split(" ").filter(Boolean));
  const rightSet = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function classifyCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  let best = "geopolitical";
  let bestScore = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter((keyword) => text.includes(keyword)).length;
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

function deriveSourceType(name: string, parserType: string, official: boolean): string {
  if (official) return `official_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  if (parserType === "newsapi") return "newsapi";
  if (parserType === "gdelt") return "gdelt";
  return `feed_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function parseRssItems(
  xml: string,
  sourceName: string,
  sourceType: string,
  official = false,
): Article[] {
  const items: Article[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const description = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "").trim() ?? "";
    const url = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const rawDate = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim()
      ?? block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1]?.trim()
      ?? null;
    if (title.length > 10 && url) {
      items.push({
        title,
        description: description || title,
        url,
        source: { name: sourceName },
        publishedAt: safeIso(rawDate),
        _ingestionSource: sourceType,
        _isOfficial: official,
      });
    }
  }
  return items;
}

function parseAtomItems(
  xml: string,
  sourceName: string,
  sourceType: string,
  official = false,
): Article[] {
  const items: Article[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "").trim() ?? "";
    const content = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "").trim() ?? "";
    const url = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const rawDate = block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]?.trim()
      ?? block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]?.trim()
      ?? null;
    if (title.length > 10 && url) {
      items.push({
        title,
        description: summary || content || title,
        url,
        source: { name: sourceName },
        publishedAt: safeIso(rawDate),
        _ingestionSource: sourceType,
        _isOfficial: official,
      });
    }
  }
  return items;
}

async function loadRegistrySources(
  supabase: ReturnType<typeof createClient>,
): Promise<RegistrySource[]> {
  const { data, error } = await supabase
    .from("signal_source_registry")
    .select("source_name,source_type,parser_type,urls,enabled,priority,official_source,trust_weight")
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (error) throw new Error(`Failed to load signal_source_registry: ${error.message}`);
  return (data ?? []) as RegistrySource[];
}

async function fetchRegistrySources(
  registrySources: RegistrySource[],
): Promise<{ articles: Article[]; runs: ConnectorRun[] }> {
  const runs: ConnectorRun[] = [];
  const results = await Promise.allSettled(
    registrySources
      .filter((source) => source.parser_type !== "newsapi" && source.parser_type !== "gdelt")
      .map(async (source): Promise<Article[]> => {
        const articles: Article[] = [];
        const sourceType = source.source_type
          || deriveSourceType(source.source_name, source.parser_type, source.official_source);
        for (const url of source.urls ?? []) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          try {
            const response = await fetch(url, {
              signal: controller.signal,
              headers: { "User-Agent": "AICIS/1.0 Signal Intelligence Platform" },
            });
            if (!response.ok) {
              runs.push({ name: source.source_name, status: "failed", count: 0, error: `HTTP ${response.status}` });
              continue;
            }
            const text = await response.text();
            const parsed = source.parser_type === "rss"
              ? parseRssItems(text, source.source_name, sourceType, source.official_source)
              : source.parser_type === "atom"
              ? parseAtomItems(text, source.source_name, sourceType, source.official_source)
              : [];
            articles.push(...parsed.slice(0, 12));
          } catch (error) {
            runs.push({
              name: source.source_name,
              status: "failed",
              count: 0,
              error: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
            });
          } finally {
            clearTimeout(timeout);
          }
        }
        if (articles.length > 0) {
          runs.push({ name: source.source_name, status: "success", count: articles.length });
        } else if (!runs.some((run) => run.name === source.source_name)) {
          runs.push({ name: source.source_name, status: "empty", count: 0 });
        }
        return articles;
      }),
  );

  const articles: Article[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") articles.push(...result.value);
  }
  return { articles, runs };
}

async function fetchNewsApiArticles(apiKey: string | undefined): Promise<Article[]> {
  if (!apiKey) return [];
  const queries = [
    "fuel OR diesel OR jet fuel OR refinery",
    "trade OR tariff OR export restriction",
    "prime minister OR president OR bilateral",
    "port OR shipping OR logistics",
  ];
  const urls = [
    ...["general", "business", "health", "science", "technology"].map(
      (category) => `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=10&apiKey=${apiKey}`,
    ),
    ...queries.map(
      (query) => `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${apiKey}`,
    ),
  ];

  const results = await Promise.allSettled(urls.map(async (url): Promise<Article[]> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return [];
      const payload = await response.json();
      const rows = Array.isArray(payload?.articles) ? payload.articles : [];
      return rows.flatMap((article: Record<string, unknown>) => {
        const title = typeof article.title === "string" ? article.title : "";
        const description = typeof article.description === "string" ? article.description : title;
        const articleUrl = typeof article.url === "string" ? article.url : "";
        const sourceObject = article.source && typeof article.source === "object"
          ? article.source as Record<string, unknown>
          : {};
        const sourceName = typeof sourceObject.name === "string" ? sourceObject.name : "NewsAPI";
        if (title.length <= 10 || !articleUrl) return [];
        return [{
          title,
          description,
          url: articleUrl,
          source: { name: sourceName },
          publishedAt: safeIso(article.publishedAt),
          _ingestionSource: url.includes("/everything?") ? "newsapi_search" : "newsapi",
        } satisfies Article];
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }));

  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

function gdeltSeenDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const expanded = value.replace(
    /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
    "$1-$2-$3T$4:$5:$6Z",
  );
  return safeIso(expanded);
}

async function fetchGdeltArticles(): Promise<Article[]> {
  const results = await Promise.allSettled(GDELT_QUERIES.map(async (query): Promise<Article[]> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=12&timespan=6h`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return [];
      const payload = await response.json();
      const rows = Array.isArray(payload?.articles) ? payload.articles : [];
      return rows.flatMap((row: Record<string, unknown>) => {
        const title = typeof row.title === "string" ? row.title : "";
        const articleUrl = typeof row.url === "string" ? row.url : "";
        if (title.length <= 10 || !articleUrl) return [];
        const domain = typeof row.domain === "string" && row.domain ? row.domain : "GDELT";
        return [{
          title,
          description: `GDELT document index: ${title}`,
          url: articleUrl,
          source: { name: domain },
          publishedAt: gdeltSeenDate(row.seendate),
          _ingestionSource: "gdelt",
        } satisfies Article];
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function updateBenchmarks(
  supabase: ReturnType<typeof createClient>,
): Promise<BenchmarkAudit> {
  const { data, error } = await supabase
    .from("signal_detection_benchmarks")
    .select("id,event_title,event_summary,event_occurred_at")
    .in("validation_status", ["pending", "needs_review"])
    .order("event_occurred_at", { ascending: false })
    .limit(100);
  if (error) return { detected: 0, missed: 0, total: 0, review_candidates: 0 };

  let reviewCandidates = 0;
  for (const benchmark of data ?? []) {
    if (!benchmark.event_occurred_at) {
      await supabase.from("signal_detection_benchmarks").update({
        validation_status: "needs_review",
        validation_notes: "Benchmark occurrence time is missing; automatic detection/latency assessment withheld.",
      }).eq("id", benchmark.id);
      continue;
    }

    const start = new Date(new Date(benchmark.event_occurred_at).getTime() - 24 * 3_600_000).toISOString();
    const end = new Date(new Date(benchmark.event_occurred_at).getTime() + 7 * 24 * 3_600_000).toISOString();
    const { data: candidates } = await supabase
      .from("global_signals")
      .select("id,title,first_detected_at,ingested_at")
      .gte("first_detected_at", start)
      .lte("first_detected_at", end)
      .order("first_detected_at", { ascending: true })
      .limit(100);

    let best: { id: string; title: string; first_detected_at: string | null; ingested_at: string | null } | null = null;
    let bestSimilarity = 0;
    for (const candidate of candidates ?? []) {
      const similarity = jaccardSimilarity(benchmark.event_title ?? "", candidate.title ?? "");
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        best = candidate;
      }
    }

    if (best && bestSimilarity >= 0.55) {
      reviewCandidates += 1;
      await supabase.from("signal_detection_benchmarks").update({
        detected: null,
        detected_signal_id: best.id,
        detected_at: best.ingested_at ?? best.first_detected_at ?? null,
        detection_latency_minutes: null,
        validation_status: "needs_review",
        validation_notes: `Lexical candidate similarity ${bestSimilarity.toFixed(2)}; similarity is not proof of benchmark-event identity.`,
      }).eq("id", benchmark.id);
    } else {
      await supabase.from("signal_detection_benchmarks").update({
        detected: null,
        detected_signal_id: null,
        detected_at: null,
        detection_latency_minutes: null,
        validation_status: "needs_review",
        validation_notes: "No strong lexical candidate found; absence of a candidate is not proof that the event was missed.",
      }).eq("id", benchmark.id);
    }
  }

  return {
    detected: 0,
    missed: 0,
    total: (data ?? []).length,
    review_candidates: reviewCandidates,
  };
}

async function snapshotCoverage(
  supabase: ReturnType<typeof createClient>,
  registrySources: RegistrySource[],
  benchmarkAudit: BenchmarkAudit,
) {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [runs, failed, signals, sources, benchmarkSummary] = await Promise.all([
    supabase.from("source_connector_runs").select("id", { count: "exact", head: true }).gte("run_at", since),
    supabase.from("source_connector_runs").select("id", { count: "exact", head: true }).gte("run_at", since).neq("run_status", "success"),
    supabase.from("global_signals").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase.from("global_signals").select("primary_source").gte("created_at", since),
    supabase.from("signal_detection_benchmarks").select("detected,detection_latency_minutes,validation_status"),
  ]);

  const uniqueSources = new Set((sources.data ?? []).map((row) => row.primary_source).filter(Boolean)).size;
  const benchmarks = benchmarkSummary.data ?? [];
  const detectedCount = benchmarks.filter((row) => row.detected === true && row.validation_status === "detected").length;
  const missedCount = benchmarks.filter((row) => row.validation_status === "missed").length;
  const latencies = benchmarks
    .map((row) => row.detection_latency_minutes)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const avgLatency = latencies.length > 0
    ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2))
    : null;

  await supabase.from("signal_coverage_snapshots").upsert({
    snapshot_date: new Date().toISOString().slice(0, 10),
    total_sources: registrySources.length,
    active_sources: registrySources.filter((source) => source.enabled).length,
    official_sources: registrySources.filter((source) => source.official_source).length,
    total_runs_24h: runs.count ?? null,
    failed_runs_24h: failed.count ?? null,
    new_signals_24h: signals.count ?? null,
    unique_sources_24h: uniqueSources,
    benchmarks_total: benchmarks.length,
    benchmarks_detected: detectedCount,
    benchmarks_missed: missedCount,
    avg_detection_latency_minutes: avgLatency,
    metadata: {
      benchmark_audit_run: benchmarkAudit,
      benchmark_semantics: "only explicitly validated detected/missed statuses counted; lexical candidates remain needs_review",
      generated_at: new Date().toISOString(),
    },
  }, { onConflict: "snapshot_date" });
}

async function logConnectorRun(
  supabase: ReturnType<typeof createClient>,
  source: string,
  status: string,
  fetched: number,
  newCount: number,
  durationMs: number,
  error?: string,
) {
  try {
    await supabase.from("source_connector_runs").insert({
      source_name: source,
      source_type: source.startsWith("official_") ? "official_feed" : source === "gdelt" ? "aggregator" : "news_api",
      run_status: status,
      signals_fetched: fetched,
      signals_new: newCount,
      signals_merged: 0,
      duration_ms: durationMs,
      ...(error ? { error_message: error } : {}),
    });
  } catch (logError) {
    console.error("Failed to log connector run:", logError);
  }
}

async function runIntake(opts: {
  runBenchmarks: boolean;
  shardCount: number;
  shardIndex: number;
  shardSize: number;
}) {
  const intakeStart = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase runtime credentials");

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const run = await startProviderRun(supabase, {
    provider_name: "ingest-global-signals",
    endpoint: "ingest-global-signals",
    scheduler_source: "cron",
    params: { shardIndex: opts.shardIndex, shardSize: opts.shardSize },
  });

  try {
    const [allRegistrySources, newsArticles, gdeltArticles] = await Promise.all([
      loadRegistrySources(supabase),
      fetchNewsApiArticles(Deno.env.get("NEWSAPI_KEY")),
      fetchGdeltArticles(),
    ]);

    let registrySources = [...allRegistrySources];
    if (opts.shardSize > 0 && registrySources.length > opts.shardSize) {
      const shards: RegistrySource[][] = [];
      for (let index = 0; index < registrySources.length; index += opts.shardSize) {
        shards.push(registrySources.slice(index, index + opts.shardSize));
      }
      const shardIndex = ((opts.shardIndex % shards.length) + shards.length) % shards.length;
      registrySources = shards[shardIndex];
    }

    const registryResult = await fetchRegistrySources(registrySources);
    const allArticles = [...newsArticles, ...gdeltArticles, ...registryResult.articles]
      .filter((article) => article.title.length > 10 && article.url);

    await Promise.allSettled(registryResult.runs.map((connectorRun) =>
      logConnectorRun(
        supabase,
        connectorRun.name,
        connectorRun.status,
        connectorRun.count,
        0,
        Date.now() - intakeStart,
        connectorRun.error,
      )
    ));

    // Exact source-record dedup only. No lexical/fuzzy same-event merge occurs here.
    const unique = new Map<string, Article>();
    for (const article of allArticles) {
      const key = recordKey(article);
      if (!unique.has(key)) unique.set(key, article);
    }
    const articles = [...unique.values()].slice(0, 80);
    const dedupKeys = articles.map(recordKey);

    const existingKeys = new Set<string>();
    for (let index = 0; index < dedupKeys.length; index += 100) {
      const chunk = dedupKeys.slice(index, index + 100);
      const { data } = await supabase.from("global_signals").select("dedup_key").in("dedup_key", chunk);
      for (const row of data ?? []) if (row.dedup_key) existingKeys.add(row.dedup_key);
    }

    const pending = articles.filter((article) => !existingKeys.has(recordKey(article)));
    const signals: Record<string, unknown>[] = [];

    for (const article of pending) {
      const detectedAt = new Date().toISOString();
      const sourceName = article.source.name || "Unknown";
      const registry = allRegistrySources.find(
        (source) => source.source_name.toLowerCase() === sourceName.toLowerCase(),
      );
      const officialKnown = registry ? Boolean(registry.official_source) : article._isOfficial === true ? true : null;
      const officialSemantics = registry
        ? "signal_source_registry_configuration_v1"
        : article._isOfficial === true
        ? "provider_adapter_explicit_official_source_flag_v1"
        : null;
      const sourcePublishedAt = safeIso(article.publishedAt);
      const evidenceHash = await sha256Hex(
        `${article.title}|${article.url}|${sourcePublishedAt ?? "publication-time-unknown"}`,
      );

      signals.push({
        title: article.title,
        summary: article.description || article.title,
        category: classifyCategory(article.title, article.description || ""),
        status: "new",

        confidence_score: null,
        confidence_score_semantics: "not_assessed_at_intake_no_signal_score",
        impact_score: null,
        impact_score_semantics: "not_assessed_at_intake_no_impact_score",
        urgency_score: null,
        urgency_score_semantics: "not_assessed_at_intake_no_urgency_score",
        source_rank_score: null,
        source_rank_score_semantics: "not_assessed_at_intake_no_source_rank_score",
        routing_score: null,
        routing_score_semantics: "not_assessed_at_intake_no_routing_score",

        source_count: 1,
        source_count_semantics: "single_observed_source_record_count_v1_not_independence",
        source_identifier_count: 1,
        source_identifier_count_semantics: "single_source_identifier_descriptive_only_not_independence",
        merged_source_count: 1,
        merged_source_count_semantics: "single_source_record_no_cross_report_grouping",
        source_grouping_semantics: "single_source_record_no_cross_report_grouping",
        source_independence_status: "not_assessed",
        source_independence_semantics: "single_report_independence_not_applicable_until_corroboration_set_exists",
        independent_origin_count: null,
        corroboration_count: null,
        corroboration_count_semantics: "not_assessed_no_independent_origin_set",
        multi_source_confirmed: null,
        multi_source_confirmation_semantics: "not_assessed_no_independent_origin_set",

        primary_source: sourceName,
        canonical_source_name: sourceName,
        source_references: [{
          url: article.url,
          name: sourceName,
          published: sourcePublishedAt,
          publication_time_semantics: sourcePublishedAt
            ? "source_reported_publication_or_update_time_v1"
            : "missing",
        }],
        source_published_at: sourcePublishedAt,
        source_published_at_semantics: sourcePublishedAt
          ? "source_reported_publication_or_update_time_v1_not_event_occurrence"
          : "missing_source_publication_time",

        first_detected_at: detectedAt,
        first_detected_at_semantics: "aicis_system_detection_time_v1",
        ingested_at: detectedAt,
        latest_update_at: detectedAt,
        occurred_at: null,
        occurred_at_semantics: "not_established_at_intake_publication_time_not_substituted",

        affected_regions: [],
        affected_countries: [],
        affected_sectors: [],
        affected_stakeholders: [],
        evidence_hash: evidenceHash,
        ingestion_source: article._ingestionSource || "registry_feed",
        dedup_key: recordKey(article),
        source_record_key: recordKey(article),
        source_lineage_status: "unknown",
        source_lineage_method: null,
        source_origin_key: null,
        source_lineage_evidence: {},

        enrichment_status: "pending_enrichment",
        enrichment_attempts: 0,
        official_source: officialKnown,
        official_source_semantics: officialSemantics,
        official_source_present: officialKnown,
        official_source_present_semantics: officialSemantics,
      });
    }

    const { data: inserted, error: insertError } = signals.length > 0
      ? await supabase.from("global_signals").insert(signals).select("id")
      : { data: [], error: null };
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    const durationMs = Date.now() - intakeStart;
    await Promise.allSettled([
      logConnectorRun(supabase, "newsapi", "success", newsArticles.length, inserted?.length ?? 0, durationMs),
      gdeltArticles.length > 0
        ? logConnectorRun(supabase, "gdelt", "success", gdeltArticles.length, 0, durationMs)
        : Promise.resolve(),
    ]);

    const benchmarkAudit = opts.runBenchmarks
      ? await updateBenchmarks(supabase)
      : { detected: 0, missed: 0, total: 0, skipped: true };
    await snapshotCoverage(supabase, allRegistrySources, benchmarkAudit);

    await supabase.from("audit_log").insert({
      action: "global_signal_fast_intake",
      resource_type: "global_signals",
      severity: "info",
      metadata: {
        intake_semantics: "one_source_report_one_signal_no_fuzzy_same_event_merge_v2",
        articles_fetched: allArticles.length,
        exact_source_records_after_dedup: articles.length,
        signals_created: inserted?.length ?? 0,
        signals_updated: 0,
        duration_ms: durationMs,
        benchmark_audit: benchmarkAudit,
        source_publication_time_substituted_for_event_time: false,
        default_confidence_created: false,
        default_impact_created: false,
        default_urgency_created: false,
      },
    });

    await finishProviderRun(supabase, run, {
      records_inserted: inserted?.length ?? 0,
      records_updated: 0,
      records_normalized: inserted?.length ?? 0,
    });

    return {
      ok: true,
      new_signals: inserted?.length ?? 0,
      updated_signals: 0,
      pending_enrichment: inserted?.length ?? 0,
      duration_ms: durationMs,
      benchmark_audit: benchmarkAudit,
      intake_semantics: "one_source_report_one_signal_no_fuzzy_same_event_merge_v2",
      sources: {
        newsapi: newsArticles.length,
        gdelt: gdeltArticles.length,
        registry: registryResult.articles.length,
        registry_total: registrySources.length,
      },
    };
  } catch (error) {
    await failProviderRun(supabase, run, error);
    throw error;
  }
}

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const url = new URL(req.url);
  const wait = body.wait === true || url.searchParams.get("wait") === "1";
  const runBenchmarks = body.run_benchmarks === true || url.searchParams.get("run_benchmarks") === "1";
  const shardSize = Number(body.shard_size ?? url.searchParams.get("shard_size") ?? 40);
  const shardCount = Number(body.shard_count ?? url.searchParams.get("shard_count") ?? 0);
  const defaultShardIndex = Math.floor(Date.now() / 60_000);
  const shardIndex = Number(body.shard_index ?? url.searchParams.get("shard_index") ?? defaultShardIndex);
  const opts = { runBenchmarks, shardCount, shardIndex, shardSize };

  if (wait) {
    try {
      const result = await runIntake(opts);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const task = runIntake(opts).catch((error) => {
    console.error("Background intake failed:", error);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
  }

  return new Response(JSON.stringify({
    ok: true,
    accepted: true,
    mode: "background",
    intake_semantics: "one_source_report_one_signal_no_fuzzy_same_event_merge_v2",
    started_at: new Date().toISOString(),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 202,
  });
});