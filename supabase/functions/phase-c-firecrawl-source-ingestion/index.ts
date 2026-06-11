// Phase C — Lane 1b: Firecrawl-Backed Official Source Ingestion
// Bypasses Cloudflare on IMF / OECD / World Bank press pages by routing
// through Firecrawl, then writes each press item as a T1 publication +
// intelligence_citation aligned to source_authority_registry.
//
// Doctrine: every citation is born T1 by virtue of its publisher, not
// relabeled. Failure to fetch is logged, never faked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Source {
  publisher_key: string;
  publisher_name: string;
  page_url: string;
  // Regex selecting press / news-release detail URLs on this host.
  link_pattern: RegExp;
}

const SOURCES: Source[] = [
  {
    publisher_key: "imf.org",
    publisher_name: "International Monetary Fund",
    page_url: "https://www.imf.org/en/News",
    link_pattern: /^https?:\/\/(www\.)?imf\.org\/en\/(News|Articles)\/.+/i,
  },
  {
    publisher_key: "oecd.org",
    publisher_name: "Organisation for Economic Co-operation and Development",
    page_url: "https://www.oecd.org/en/about/news.html",
    link_pattern: /^https?:\/\/(www\.)?oecd\.org\/en\/(about\/news|publications|press)\/.+/i,
  },
  {
    publisher_key: "worldbank.org",
    publisher_name: "World Bank",
    page_url: "https://www.worldbank.org/en/news",
    link_pattern: /^https?:\/\/(www\.)?worldbank\.org\/en\/news\/(press-release|statement|feature|opinion|speech)\/.+/i,
  },
];

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface FirecrawlScrape {
  success?: boolean;
  data?: {
    markdown?: string;
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  // SDK-style flat shape (defensive)
  markdown?: string;
  links?: string[];
}

async function firecrawlScrape(url: string, apiKey: string): Promise<FirecrawlScrape> {
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "links"],
      onlyMainContent: true,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as FirecrawlScrape;
}

// Pull a plausible title for a URL from the page markdown.
// Heuristic: find the link's anchor text in markdown like `[Title](URL)`.
function inferTitleFromMarkdown(markdown: string, url: string): string | undefined {
  if (!markdown) return undefined;
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[([^\\]]{4,300})\\]\\(${escaped}\\)`);
  const m = markdown.match(re);
  if (m) return m[1].trim().replace(/\s+/g, " ");
  return undefined;
}

interface SourceResult {
  publisher_key: string;
  candidate_links: number;
  inserted_publications: number;
  inserted_citations: number;
  error?: string;
}

async function ingestSource(
  supabase: ReturnType<typeof createClient>,
  source: Source,
  apiKey: string,
): Promise<SourceResult> {
  const result: SourceResult = {
    publisher_key: source.publisher_key,
    candidate_links: 0,
    inserted_publications: 0,
    inserted_citations: 0,
  };

  try {
    const scrape = await firecrawlScrape(source.page_url, apiKey);
    const markdown = scrape.data?.markdown ?? scrape.markdown ?? "";
    const links = scrape.data?.links ?? scrape.links ?? [];

    // Dedupe + filter to press-release URL pattern
    const unique = Array.from(new Set(links.filter((l) => source.link_pattern.test(l))));
    result.candidate_links = unique.length;

    // Cap to keep edge-function within time budget
    for (const link of unique.slice(0, 80)) {
      const title = inferTitleFromMarkdown(markdown, link) ?? link;
      const content_hash = await sha256Hex(`${source.publisher_key}|${link}`);

      const { data: pub, error: pubErr } = await supabase
        .from("official_publications")
        .upsert(
          {
            publisher_key: source.publisher_key,
            title: title.slice(0, 1000),
            link,
            summary: null,
            published_at: null,
            content_hash,
          },
          { onConflict: "publisher_key,content_hash" },
        )
        .select("id, created_at")
        .single();

      if (pubErr || !pub) continue;

      const isNew = Math.abs(Date.now() - new Date((pub as any).created_at).getTime()) < 60_000;
      if (isNew) result.inserted_publications++;

      // Idempotent: skip if a citation already exists for this publication
      const { count: existing } = await supabase
        .from("intelligence_citations")
        .select("id", { count: "exact", head: true })
        .eq("subject_type", "official_publication")
        .eq("subject_id", (pub as any).id);

      if ((existing ?? 0) > 0) continue;

      const { error: citErr } = await supabase.from("intelligence_citations").insert({
        subject_type: "official_publication",
        subject_id: (pub as any).id,
        publisher_key: source.publisher_key,
        source_name: source.publisher_name,
        source_url: link,
        source_type: "official",
        published_at: null,
        quote: null,
        source_hash: content_hash,
        confidence_weight: 1.0,
        ingest_lane: "official_source_firecrawl",
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

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "FIRECRAWL_API_KEY is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = Date.now();

  // Sequential to keep Firecrawl rate-limit pressure low; per-source is fast.
  const results: SourceResult[] = [];
  for (const s of SOURCES) {
    results.push(await ingestSource(supabase, s, apiKey));
  }

  const summary = {
    duration_ms: Date.now() - started,
    sources: results.length,
    total_candidate_links: results.reduce((a, r) => a + r.candidate_links, 0),
    total_new_publications: results.reduce((a, r) => a + r.inserted_publications, 0),
    total_new_citations: results.reduce((a, r) => a + r.inserted_citations, 0),
    results,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
