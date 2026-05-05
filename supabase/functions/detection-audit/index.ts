/**
 * detection-audit — daily "what did we miss" scoring.
 *
 * Pulls trending world-event queries via Firecrawl Search, then for each top
 * result checks whether AICIS detected a similar event in `global_signals`
 * within the configured window. Writes a `detection_audit_runs` row with
 * detection rate + per-event detail + auto-creates `signal_detection_benchmarks`
 * for any miss so the system learns from blind spots.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "detection-audit";
const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

const TRENDING_QUERIES = [
  "biggest world news today",
  "major political events today",
  "global economic news today",
  "energy market news today",
  "supply chain disruption today",
  "international conflict update today",
  "natural disaster today",
  "cybersecurity incident today",
  "major court ruling today",
  "central bank decision today",
];

function norm(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function jaccard(a: string, b: string) {
  const A = new Set(norm(a).split(" "));
  const B = new Set(norm(b).split(" "));
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
}

async function fcSearch(apiKey: string, query: string, limit = 5): Promise<any[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${FIRECRAWL_V2}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ query, limit, tbs: "qdr:d", sources: ["news"] }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const hits = j?.data?.news ?? j?.news ?? j?.data?.web ?? j?.web ?? [];
    return hits.filter((h: any) => h.url && h.title);
  } catch {
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
    return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Pull recent global_signals once
  const { data: recent } = await supabase
    .from("global_signals")
    .select("id, title, summary, ingested_at, occurred_at")
    .gte("first_detected_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString())
    .order("first_detected_at", { ascending: false })
    .limit(800);
  const recentSignals = (recent || []) as any[];

  const trendingHits: any[] = [];
  for (const q of TRENDING_QUERIES) {
    const hits = await fcSearch(apiKey, q, 4);
    for (const h of hits) trendingHits.push({ ...h, _sourceQuery: q });
    await new Promise(r => setTimeout(r, 200));
  }

  // Dedup trending hits by normalized title
  const seen = new Set<string>();
  const uniqueTrending = trendingHits.filter(h => {
    const k = norm(h.title).split(" ").slice(0, 8).join(" ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let detected = 0, missed = 0;
  const latencies: number[] = [];
  const detectedDetail: any[] = [];
  const missedDetail: any[] = [];
  const benchmarksToInsert: any[] = [];

  for (const hit of uniqueTrending) {
    let bestScore = 0;
    let bestSig: any = null;
    for (const sig of recentSignals) {
      const sc = Math.max(
        jaccard(hit.title, sig.title) * 0.7 + jaccard(hit.description || "", sig.summary || "") * 0.3,
        jaccard(hit.title, sig.title),
      );
      if (sc > bestScore) { bestScore = sc; bestSig = sig; }
    }

    const eventOccurredAt = hit.publishedDate ? new Date(hit.publishedDate).toISOString() : new Date().toISOString();
    if (bestSig && bestScore >= 0.45) {
      detected++;
      const detectedAt = bestSig.ingested_at || bestSig.occurred_at;
      if (detectedAt && hit.publishedDate) {
        const lat = (new Date(detectedAt).getTime() - new Date(hit.publishedDate).getTime()) / 60000;
        if (lat >= 0 && lat < 7 * 24 * 60) latencies.push(lat);
      }
      detectedDetail.push({
        title: hit.title.slice(0, 200),
        url: hit.url,
        signal_id: bestSig.id,
        similarity: Number(bestScore.toFixed(2)),
        query: hit._sourceQuery,
      });
    } else {
      missed++;
      missedDetail.push({
        title: hit.title.slice(0, 200),
        url: hit.url,
        best_similarity: Number(bestScore.toFixed(2)),
        query: hit._sourceQuery,
        published: hit.publishedDate || null,
      });
      benchmarksToInsert.push({
        benchmark_key: `audit_${norm(hit.title).split(" ").slice(0,8).join("_")}`.slice(0,200),
        event_title: hit.title.slice(0, 500),
        event_summary: (hit.description || hit.title).slice(0, 1000),
        source_url: hit.url,
        source_name: "firecrawl_audit",
        event_occurred_at: eventOccurredAt,
        validation_status: "missed",
        detected: false,
        validation_notes: `Auto-flagged by detection-audit (best similarity ${bestScore.toFixed(2)})`,
      });
    }
  }

  // Persist auto-created benchmarks (idempotent on event_url if column unique; otherwise just insert)
  if (benchmarksToInsert.length > 0) {
    await supabase.from("signal_detection_benchmarks")
      .upsert(benchmarksToInsert, { onConflict: "event_url", ignoreDuplicates: true });
  }

  const total = uniqueTrending.length;
  const detectionRate = total > 0 ? Number((detected * 100 / total).toFixed(2)) : 0;
  const avgLatency = latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : null;

  await supabase.from("detection_audit_runs").insert({
    trending_events_checked: total,
    events_detected: detected,
    events_missed: missed,
    detection_rate: detectionRate,
    avg_latency_minutes: avgLatency,
    detected_events: detectedDetail,
    missed_events: missedDetail,
    query_set: "global_breaking_v1",
    metadata: { duration_ms: Date.now() - start, queries: TRENDING_QUERIES },
  });

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: "success",
    message: `Checked ${total} trending events: ${detected} detected (${detectionRate}%), ${missed} missed`,
  });

  return new Response(JSON.stringify({
    ok: true,
    checked: total,
    detected,
    missed,
    detection_rate: detectionRate,
    avg_latency_minutes: avgLatency,
    duration_ms: Date.now() - start,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
