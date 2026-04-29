/**
 * lril-ingest — Local Reality Ingestion Layer: raw signal intake
 *
 * Pulls from multi-source feeds and writes deduplicated raw signals to
 * `aicis_raw_local_signals`. Each source is isolated so one failure
 * cannot block the others. Designed to run every 30 minutes.
 *
 * Sources wired:
 *  1. GDELT DOC API (global news, multilingual) — high volume, no key
 *  2. ReliefWeb (NGO/disaster reports) — JSON, no key
 *  3. Custom payload mode: callers may POST { source_name, items: [...] }
 *
 * Writes are upserted by dedup_key for idempotency.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "lril-ingest";

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

interface RawSignal {
  source_type: string;
  source_name: string;
  source_reliability: number;
  raw_text: string;
  raw_payload: any;
  language: string;
  url: string | null;
  published_at: string | null;
  country_hint: string | null;
  region_hint: string | null;
  dedup_key: string;
}

async function pullGDELT(): Promise<RawSignal[]> {
  // Single conservative query (rate limit: 1 req / 5s — we run every 30 min so OK)
  const q = encodeURIComponent('(protest OR blackout OR flood OR outbreak OR coup)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=100&format=json&sort=DateDesc`;
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
  const text = await r.text();
  if (!text.trim().startsWith("{")) throw new Error(`GDELT non-JSON: ${text.slice(0, 80)}`);
  const j = JSON.parse(text);
  const articles = (j.articles || []) as any[];
  return articles.map((a) => {
    const iso3 = (a.sourcecountry || "").toUpperCase().slice(0, 3) || null;
    return {
      source_type: "aggregator",
      source_name: a.domain || "gdelt",
      source_reliability: 0.55,
      raw_text: a.title || "",
      raw_payload: a,
      language: (a.language || "en").toLowerCase().slice(0, 2),
      url: a.url || null,
      published_at: a.seendate ? parseGDELTDate(a.seendate) : null,
      country_hint: iso3 && iso3.length === 3 ? iso3 : null,
      region_hint: null,
      dedup_key: `gdelt_${hash(a.url || a.title || crypto.randomUUID())}`,
    } satisfies RawSignal;
  });
}

function parseGDELTDate(s: string): string | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function pullGDACS(): Promise<RawSignal[]> {
  // GDACS — Global Disaster Alert (EU JRC). Open, no key, no rate limit.
  const url = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Green;Orange;Red";
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`GDACS HTTP ${r.status}`);
  const j = await r.json();
  const features = (j.features || []) as any[];
  return features.map((f) => {
    const p = f.properties || {};
    const eventType = (p.eventtype || "disaster").toString();
    const text = (p.name || p.htmldescription || `GDACS ${eventType}`).toString();
    return {
      source_type: "ngo",
      source_name: "gdacs",
      source_reliability: 0.92,
      raw_text: text,
      raw_payload: p,
      language: "en",
      url: p.url?.report || null,
      published_at: p.fromdate || null,
      country_hint: (p.iso3 || "").toUpperCase().slice(0, 3) || null,
      region_hint: p.country || null,
      dedup_key: `gdacs_${p.eventid || p.episodeid || hash(p.url?.report || text)}`,
    } satisfies RawSignal;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  const summary: Record<string, number | string> = {};
  const all: RawSignal[] = [];

  // Optional caller-supplied items
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body?.items)) {
        for (const it of body.items) {
          all.push({
            source_type: it.source_type || "news",
            source_name: it.source_name || body.source_name || "custom",
            source_reliability: typeof it.source_reliability === "number" ? it.source_reliability : 0.6,
            raw_text: it.raw_text || it.text || "",
            raw_payload: it.raw_payload || it,
            language: (it.language || "en").toLowerCase().slice(0, 2),
            url: it.url || null,
            published_at: it.published_at || new Date().toISOString(),
            country_hint: it.country_hint || it.iso3 || null,
            region_hint: it.region_hint || null,
            dedup_key: it.dedup_key || `custom_${hash(it.url || it.raw_text || crypto.randomUUID())}`,
          });
        }
        summary.custom = body.items.length;
      }
    } catch (_) { /* ignore */ }
  }

  // GDELT
  try {
    const ev = await pullGDELT();
    all.push(...ev);
    summary.gdelt = ev.length;
  } catch (e) {
    summary.gdelt_error = (e as Error).message;
  }

  // ReliefWeb
  try {
    const ev = await pullReliefWeb();
    all.push(...ev);
    summary.reliefweb = ev.length;
  } catch (e) {
    summary.reliefweb_error = (e as Error).message;
  }

  let inserted = 0;
  if (all.length > 0) {
    // Chunked upsert
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      const { data, error } = await supabase
        .from("aicis_raw_local_signals")
        .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) { summary.insert_error = error.message; break; }
      inserted += data?.length || 0;
    }
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: summary.insert_error ? "error" : "success",
    message: `Ingested ${inserted}/${all.length} signals. ${JSON.stringify(summary)} (${Date.now() - start}ms)`,
  });

  return new Response(JSON.stringify({ ok: true, inserted, sourced: all.length, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
