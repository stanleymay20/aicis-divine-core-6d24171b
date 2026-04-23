// AICIS Training Dataset Builder
// Triggers the build_training_dataset_aicis SQL function in safe chunks and returns stats.
// Also supports ?export=csv to stream the dataset as CSV for external Python training.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const url = new URL(req.url);
    const isExport = url.searchParams.get("export") === "csv";

    if (isExport) {
      const split = url.searchParams.get("split");
      let q = supabase
        .from("training_dataset_aicis")
        .select("*")
        .order("snapshot_date", { ascending: true })
        .limit(50000);
      if (split && split !== "all") q = q.eq("dataset_split", split);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) {
        return new Response("no rows", { status: 404, headers: corsHeaders });
      }
      const cols = Object.keys(data[0]);
      const header = cols.join(",");
      const rows = data
        .map((r: Record<string, unknown>) => cols.map((c) => csvEscape(r[c])).join(","))
        .join("\n");
      return new Response(`${header}\n${rows}\n`, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="aicis_training_${split ?? "all"}.csv"`,
        },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const horizon = Number(body.horizon_days ?? 7);
    const endDate: string = body.end_date ?? new Date().toISOString().slice(0, 10);
    const startDate: string =
      body.start_date ??
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const chunkDays = Math.max(1, Math.min(Number(body.chunk_days ?? 1), 7));

    console.log(
      `[build-training-dataset] Building ${startDate} → ${endDate}, horizon=${horizon}d, chunk_days=${chunkDays}`,
    );

    const aggregate = {
      rows_inserted: 0,
      rows_with_label: 0,
      build_seconds: 0,
      chunks_completed: 0,
      chunk_days: chunkDays,
      failures: [] as Array<{ start: string; end: string; error: string }>,
    };

    let cursor = startDate;
    while (compareIsoDates(cursor, endDate) <= 0) {
      const chunkEndCandidate = addDays(cursor, chunkDays - 1);
      const chunkEnd = compareIsoDates(chunkEndCandidate, endDate) <= 0 ? chunkEndCandidate : endDate;

      const { data, error } = await supabase.rpc("build_training_dataset_aicis", {
        p_start_date: cursor,
        p_end_date: chunkEnd,
        p_horizon_days: horizon,
      });

      if (error) {
        aggregate.failures.push({
          start: cursor,
          end: chunkEnd,
          error: error.message ?? String(error),
        });
      } else {
        const stats = Array.isArray(data) ? data[0] : data;
        aggregate.rows_inserted += Number(stats?.rows_inserted ?? 0);
        aggregate.rows_with_label += Number(stats?.rows_with_label ?? 0);
        aggregate.build_seconds += Number(stats?.build_seconds ?? 0);
        aggregate.chunks_completed += 1;
      }

      cursor = addDays(chunkEnd, 1);
    }

    if (aggregate.chunks_completed === 0) {
      return new Response(JSON.stringify({ ok: false, error: "all chunks failed", details: aggregate.failures }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: distRows } = await supabase
      .from("training_dataset_aicis")
      .select("dataset_split, label_did_deteriorate")
      .eq("horizon_days", horizon)
      .gte("snapshot_date", startDate)
      .lte("snapshot_date", endDate);

    const dist = { train: 0, val: 0, test: 0, positives: 0, total: 0 };
    for (const r of distRows ?? []) {
      dist.total++;
      if (r.dataset_split === "train") dist.train++;
      else if (r.dataset_split === "val") dist.val++;
      else if (r.dataset_split === "test") dist.test++;
      if (r.label_did_deteriorate === 1) dist.positives++;
    }

    return new Response(
      JSON.stringify({
        ok: aggregate.failures.length === 0,
        partial: aggregate.failures.length > 0,
        window: { start: startDate, end: endDate, horizon_days: horizon, chunk_days: chunkDays },
        stats: aggregate,
        distribution: dist,
        positive_rate: dist.total > 0 ? dist.positives / dist.total : 0,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: aggregate.failures.length > 0 ? 207 : 200,
      },
    );
  } catch (e) {
    console.error("[build-training-dataset] error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});