import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    let mode = url.searchParams.get("mode") ?? "leaderboard";
    let iso3 = url.searchParams.get("iso3") ?? undefined;
    let domain = url.searchParams.get("domain") ?? undefined;
    let topN = Number(url.searchParams.get("top_n") ?? "100");

    if (req.method === "POST") {
      try {
        const body = await req.json();
        mode = body.mode ?? mode;
        iso3 = body.iso3 ?? iso3;
        domain = body.domain ?? domain;
        topN = Number(body.top_n ?? topN);
      } catch { /* ignore */ }
    }

    // ───────────── per-country query mode ─────────────
    if (mode === "score" && iso3 && domain) {
      const { data, error } = await supabase.rpc("score_country_domain_risk", {
        p_iso3: iso3.toUpperCase(),
        p_domain: domain.toLowerCase(),
      });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, mode, iso3, domain, result: data?.[0] ?? null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ───────────── refresh mode: recompute leaderboard ─────────────
    if (mode === "refresh") {
      const { data, error } = await supabase.rpc("compute_risk_ranking_baseline", { p_top_n: topN });
      if (error) throw error;
      const batch = data?.[0];
      return new Response(JSON.stringify({ success: true, mode, batch_id: batch?.batch_id, rows_inserted: batch?.rows_inserted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ───────────── leaderboard mode (default): latest batch ─────────────
    const { data: latest, error: latestErr } = await supabase
      .from("risk_ranking_predictions")
      .select("generation_batch_id, generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) throw latestErr;

    if (!latest) {
      // auto-bootstrap if empty
      const { data: bootstrap, error: bErr } = await supabase.rpc("compute_risk_ranking_baseline", { p_top_n: topN });
      if (bErr) throw bErr;
      const batchId = bootstrap?.[0]?.batch_id;
      const { data: rows } = await supabase
        .from("risk_ranking_predictions")
        .select("*")
        .eq("generation_batch_id", batchId)
        .order("rank_position", { ascending: true })
        .limit(topN);
      return new Response(JSON.stringify({ success: true, mode, bootstrapped: true, generated_at: new Date().toISOString(), rows: rows ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let q = supabase
      .from("risk_ranking_predictions")
      .select("*")
      .eq("generation_batch_id", latest.generation_batch_id)
      .order("rank_position", { ascending: true })
      .limit(topN);

    if (domain) q = q.eq("domain", domain.toLowerCase());
    if (iso3) q = q.eq("country_iso3", iso3.toUpperCase());

    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw rowsErr;

    return new Response(JSON.stringify({ success: true, mode, generated_at: latest.generated_at, rows: rows ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predict-risk-ranking error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
