// Phase C — Lane 1: Official Source Ingestion
// Pulls RSS/Atom feeds from doctrine-strict T1 publishers (WHO, IMF, World Bank,
// ECB, OECD, BIS, ReliefWeb) and writes each item as:
//   1) a row in `official_publications` (the subject)
//   2) a citation in `intelligence_citations` born as T1, publisher_key aligned
//      to the source_authority_registry, ingest_lane='official_source'.
//
// Every new citation directly raises the Authority Coverage component of the
// Trust Completion Score — earned, not relabeled.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Feed {
  publisher_key: string;
  publisher_name: string;
  url: string;
}

// Curated, stable RSS endpoints. All publishers already seeded as Tier 1
// in source_authority_registry by the accompanying migration.
const FEEDS: Feed[] = [
  { publisher_key: "who.int",       publisher_name: "World Health Organization",        url: "https://www.who.int/rss-feeds/news-english.xml" },
  { publisher_key: "imf.org",       publisher_name: "International Monetary Fund",      url: "https://www.imf.org/en/News/RSS?Language=en" },
  { publisher_key: "worldbank.org", publisher_name: "World Bank",                       url: "https://www.worldbank.org/en/news/all/rss" },
  { publisher_key: "ecb.europa.eu", publisher_name: "European Central Bank",            url: "https://www.ecb.europa.eu/rss/press.html" },
  { publisher_key: "oecd.org",      publisher_name: "OECD",                             url: "https://www.oecd.org/newsroom/index.xml" },
  { publisher_key: "bis.org",       publisher_name: "Bank for International Settlements", url: "https://www.bis.org/doclist/press.rss" },
  { publisher_key: "reliefweb.int", publisher_name: "ReliefWeb (UN OCHA)",              url: "https://reliefweb.int/updates/rss.xml" },
];

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface FeedItem {
  title: string;
  link: string;
  summary?: string;
  published_at?: string;
}

// Minimal, dependency-free RSS/Atom parser. Tolerates <item> (RSS) and <entry> (Atom).
function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blockRegex = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const blocks = xml.match(blockRegex) ?? [];

  const grab = (block: string, tag: string): string | undefined => {
    // CDATA-aware
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = block.match(re);
    if (!m) return undefined;
    let v = m[1].trim();
    v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    return v || undefined;
  };

  for (const block of blocks) {
    const title = grab(block, "title");
    if (!title) continue;

    // RSS: <link>url</link>  ;  Atom: <link href="url" />
    let link = grab(block, "link");
    if (!link || link.startsWith("<")) {
      const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) link = m[1];
    }
    if (!link) continue;

    const summary = grab(block, "description") ?? grab(block, "summary") ?? grab(block, "content");
    const pub = grab(block, "pubDate") ?? grab(block, "published") ?? grab(block, "updated");
    let published_at: string | undefined;
    if (pub) {
      const d = new Date(pub);
      if (!isNaN(d.getTime())) published_at = d.toISOString();
    }

    items.push({
      title: title.replace(/<[^>]+>/g, "").slice(0, 1000),
      link: link.trim(),
      summary: summary?.replace(/<[^>]+>/g, "").slice(0, 2000),
      published_at,
    });
  }
  return items;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface FeedResult {
  publisher_key: string;
  fetched: number;
  inserted_publications: number;
  inserted_citations: number;
  error?: string;
}

async function ingestFeed(
  supabase: ReturnType<typeof createClient>,
  feed: Feed,
): Promise<FeedResult> {
  const result: FeedResult = {
    publisher_key: feed.publisher_key,
    fetched: 0,
    inserted_publications: 0,
    inserted_citations: 0,
  };

  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }
    const xml = await res.text();
    const items = parseFeed(xml);
    result.fetched = items.length;

    for (const item of items.slice(0, 100)) {
      const content_hash = await sha256Hex(`${feed.publisher_key}|${item.link}|${item.title}`);

      // Upsert publication
      const { data: pub, error: pubErr } = await supabase
        .from("official_publications")
        .upsert(
          {
            publisher_key: feed.publisher_key,
            title: item.title,
            link: item.link,
            summary: item.summary ?? null,
            published_at: item.published_at ?? null,
            content_hash,
          },
          { onConflict: "publisher_key,content_hash" },
        )
        .select("id, created_at")
        .single();

      if (pubErr || !pub) continue;

      const isNew = Math.abs(Date.now() - new Date((pub as any).created_at).getTime()) < 60_000;
      if (isNew) result.inserted_publications++;

      // Insert citation (idempotency: skip if already exists for this subject)
      const { count: existing } = await supabase
        .from("intelligence_citations")
        .select("id", { count: "exact", head: true })
        .eq("subject_type", "official_publication")
        .eq("subject_id", (pub as any).id);

      if ((existing ?? 0) > 0) continue;

      const { error: citErr } = await supabase.from("intelligence_citations").insert({
        subject_type: "official_publication",
        subject_id: (pub as any).id,
        publisher_key: feed.publisher_key,
        source_name: feed.publisher_name,
        source_url: item.link,
        source_type: "official",
        published_at: item.published_at ?? null,
        quote: item.summary?.slice(0, 500) ?? null,
        source_hash: content_hash,
        confidence_weight: 1.0,
        ingest_lane: "official_source",
      });
      if (!citErr) result.inserted_citations++;
    }
  } catch (e) {
    result.error = (e as Error).message;
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = Date.now();
  const results: FeedResult[] = [];

  // Process feeds in parallel for throughput
  const settled = await Promise.allSettled(FEEDS.map((f) => ingestFeed(supabase, f)));
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") results.push(s.value);
    else results.push({
      publisher_key: FEEDS[i].publisher_key,
      fetched: 0, inserted_publications: 0, inserted_citations: 0,
      error: String((s as PromiseRejectedResult).reason),
    });
  }

  const summary = {
    duration_ms: Date.now() - started,
    feeds: results.length,
    total_fetched: results.reduce((s, r) => s + r.fetched, 0),
    total_new_publications: results.reduce((s, r) => s + r.inserted_publications, 0),
    total_new_citations: results.reduce((s, r) => s + r.inserted_citations, 0),
    results,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
