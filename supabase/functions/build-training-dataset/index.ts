// AICIS Training Dataset Builder
// Triggers the build_training_dataset_aicis SQL function and returns stats.
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

    // ----- CSV EXPORT MODE -----
    if (isExport) {
      const split = url.searchParams.get("split"); // train | val | test | all
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
        .map((r: any) => cols.map((c) => csvEscape(r[c])).join(","))
        .join("\n");
      return new Response(`${header}\n${rows}\n`, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="aicis_training_${split ?? "all"}.csv"`,
        },
      });
    }

    // ----- BUILD MODE -----
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const horizon = Number(body.horizon_days ?? 7);
    const endDate: string =
      body.end_date ?? new Date().toISOString().slice(0, 10);
    // default: build last 90 days (so the most recent ~horizon days won't have full labels yet)
    const startDate: string =
      body.start_date ??
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

    console.log(
      `[build-training-dataset] Building ${startDate} → ${endDate}, horizon=${horizon}d`,
    );

    const { data, error } = await supabase.rpc("build_training_dataset_aicis", {
      p_start_date: startDate,
      p_end_date: endDate,
      p_horizon_days: horizon,
    });
    if (error) throw error;

    const stats = Array.isArray(data) ? data[0] : data;

    // Quick distribution snapshot
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
        ok: true,
        window: { start: startDate, end: endDate, horizon_days: horizon },
        stats,
        distribution: dist,
        positive_rate: dist.total > 0 ? dist.positives / dist.total : 0,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
