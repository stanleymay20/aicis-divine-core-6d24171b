import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    let mode = url.searchParams.get("mode") ?? "infer";
    let horizon = Number(url.searchParams.get("horizon") ?? "7");
    let topN = Number(url.searchParams.get("top_n") ?? "100");
    let domain = url.searchParams.get("domain") ?? undefined;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        mode = body.mode ?? mode;
        horizon = Number(body.horizon ?? horizon);
        topN = Number(body.top_n ?? topN);
        domain = body.domain ?? domain;
      } catch {/* */}
    }

    if (mode === "infer") {
      const { data, error } = await sb.rpc("infer_risk_probabilities", { p_horizon_days: horizon });
      if (error) throw error;
      const batch = data?.[0];
      return json({ success: true, mode, batch_id: batch?.batch_id, rows_inserted: batch?.rows_inserted });
    }

    // mode === "list" → latest batch
    const { data: latest } = await sb
      .from("risk_ml_predictions")
      .select("generation_batch_id, generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      const { data: boot } = await sb.rpc("infer_risk_probabilities", { p_horizon_days: horizon });
      const batchId = boot?.[0]?.batch_id;
      let q = sb.from("risk_ml_predictions").select("*").eq("generation_batch_id", batchId)
        .order("risk_probability", { ascending: false }).limit(topN);
      if (domain) q = q.eq("domain", domain);
      const { data: rows } = await q;
      return json({ success: true, mode, bootstrapped: true, rows: rows ?? [] });
    }

    let q = sb.from("risk_ml_predictions").select("*")
      .eq("generation_batch_id", latest.generation_batch_id)
      .order("risk_probability", { ascending: false })
      .limit(topN);
    if (domain) q = q.eq("domain", domain);
    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw rowsErr;

    return json({ success: true, mode, generated_at: latest.generated_at, rows: rows ?? [] });
  } catch (e) {
    console.error("run-ml-inference error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
