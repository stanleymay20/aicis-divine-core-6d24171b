import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// Phase C — Lanes 2 & 3: Tiered Source Ingestion (T2 wires/broadcasters + T3 specialist research)
//
// Pulls RSS/Atom feeds from publishers seeded in source_authority_registry at
// tiers 2 and 3, then writes each item as:
//   1) a row in `official_publications` (the canonical subject)
//   2) a citation in `intelligence_citations` born at the publisher's TRUE tier
//      weight (T2=0.7, T3=0.5). Never relabeled upward; doctrine-preserving.
//
// Paywalled / bot-protected sources (Reuters, AFP, S&P, Fitch, Moody's, dpa) are
// intentionally NOT in this lane — they belong to a future Firecrawl lane.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Feed {
  publisher_key: string;
  publisher_name: string;
  url: string;
  tier: 2 | 3;
  weight: number; // T2 = 0.70, T3 = 0.50
}

const FEEDS: Feed[] = [
  // ---- Tier 2 — reputable wires & national broadcasters (public RSS) ----
  { publisher_key: "bbc.co.uk",       publisher_name: "BBC News",                  tier: 2, weight: 0.70, url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { publisher_key: "nytimes.com",     publisher_name: "The New York Times",        tier: 2, weight: 0.70, url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { publisher_key: "ft.com",          publisher_name: "Financial Times",           tier: 2, weight: 0.70, url: "https://www.ft.com/world?format=rss" },
  { publisher_key: "theguardian.com", publisher_name: "The Guardian",              tier: 2, weight: 0.70, url: "https://www.theguardian.com/world/rss" },
  { publisher_key: "nhk.or.jp",       publisher_name: "NHK World",                 tier: 2, weight: 0.70, url: "https://www3.nhk.or.jp/nhkworld/en/news/feeds/index.xml" },
  { publisher_key: "tagesschau.de",   publisher_name: "ARD Tagesschau",            tier: 2, weight: 0.70, url: "https://www.tagesschau.de/xml/rss2/" },
  { publisher_key: "abc.net.au",      publisher_name: "ABC Australia",             tier: 2, weight: 0.70, url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
  { publisher_key: "cbc.ca",          publisher_name: "CBC News",                  tier: 2, weight: 0.70, url: "https://www.cbc.ca/cmlink/rss-world" },
  { publisher_key: "apnews.com",      publisher_name: "Associated Press",          tier: 2, weight: 0.70, url: "https://apnews.com/index.rss" },
  // ---- Tier 3 — specialist research & policy (public RSS) ----
  { publisher_key: "iea.org",         publisher_name: "International Energy Agency", tier: 3, weight: 0.50, url: "https://www.iea.org/rss/news" },
  { publisher_key: "bis.org/papers",  publisher_name: "Bank for International Settlements (Working Papers)", tier: 3, weight: 0.50, url: "https://www.bis.org/list/wpapers/index.rss" },
  { publisher_key: "crisisgroup.org", publisher_name: "International Crisis Group", tier: 3, weight: 0.50, url: "https://www.crisisgroup.org/rss.xml" },
];

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface FeedItem {
  title: string;
  link: string;
  summary?: string;
  published_at?: string;
}

function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];

  const grab = (block: string, tag: string): string | undefined => {
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
  tier: 2 | 3;
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
    tier: feed.tier,
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

    const ingestLane = feed.tier === 2 ? "wire_source" : "research_source";
    const sourceType = feed.tier === 2 ? "wire" : "research";

    for (const item of items.slice(0, 100)) {
      const content_hash = await sha256Hex(`${feed.publisher_key}|${item.link}|${item.title}`);

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
        source_type: sourceType,
        published_at: item.published_at ?? null,
        quote: item.summary?.slice(0, 500) ?? null,
        source_hash: content_hash,
        confidence_weight: feed.weight,
        ingest_lane: ingestLane,
      });
      if (!citErr) result.inserted_citations++;
    }
  } catch (e) {
    result.error = (e as Error).message;
  }

  return result;
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = Date.now();
  const settled = await Promise.allSettled(FEEDS.map((f) => ingestFeed(supabase, f)));
  const results: FeedResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          publisher_key: FEEDS[i].publisher_key,
          tier: FEEDS[i].tier,
          fetched: 0,
          inserted_publications: 0,
          inserted_citations: 0,
          error: String((s as PromiseRejectedResult).reason),
        },
  );

  const summary = {
    duration_ms: Date.now() - started,
    feeds: results.length,
    t2_new_citations: results.filter((r) => r.tier === 2).reduce((s, r) => s + r.inserted_citations, 0),
    t3_new_citations: results.filter((r) => r.tier === 3).reduce((s, r) => s + r.inserted_citations, 0),
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
