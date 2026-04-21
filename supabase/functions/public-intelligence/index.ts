// Public, no-auth, sanitized intelligence preview for landing page visitors.
// Returns top risks, calibrated predictions, recent simulation summaries, and audit chain samples.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "public, max-age=60",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── Parallel fetch — all sanitized aggregate views ──
    const [topRisks, topPredictions, recentSims, auditSamples, snapshots] = await Promise.all([
      sb.from("risk_ranking_predictions")
        .select("country_iso3, domain, risk_score, confidence_lower, confidence_upper, generated_at, horizon_days")
        .order("risk_score", { ascending: false })
        .limit(8),
      sb.from("risk_ml_predictions")
        .select("country_iso3, domain, calibrated_score, raw_score, prediction_interval_lower, prediction_interval_upper, horizon_days, audit_hash, model_version")
        .order("calibrated_score", { ascending: false })
        .limit(8),
      sb.from("simulation_runs")
        .select("scenario_name, shock_domain, shock_magnitude, p10, p50, p90, n_iterations, cascade_depth, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      sb.from("ml_inference_audit")
        .select("model_version, weights_hash, combined_hash, previous_chain_hash, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      sb.from("country_performance_snapshots")
        .select("iso3", { count: "exact", head: true }),
    ]);

    // Counts for the "live stats" strip
    const [{ count: snapshotCount }, { count: predictionCount }, { count: simCount }, { count: auditCount }] =
      await Promise.all([
        sb.from("country_performance_snapshots").select("*", { count: "exact", head: true }),
        sb.from("risk_ml_predictions").select("*", { count: "exact", head: true }),
        sb.from("simulation_runs").select("*", { count: "exact", head: true }),
        sb.from("ml_inference_audit").select("*", { count: "exact", head: true }),
      ]);

    const { data: countryRows } = await sb
      .from("country_performance_snapshots")
      .select("iso3")
      .limit(50000);
    const distinctCountries = new Set((countryRows ?? []).map(r => r.iso3)).size;

    return new Response(JSON.stringify({
      generated_at: new Date().toISOString(),
      stats: {
        countries_tracked: distinctCountries,
        snapshots: snapshotCount ?? 0,
        ml_predictions: predictionCount ?? 0,
        simulations_run: simCount ?? 0,
        audit_records: auditCount ?? 0,
      },
      top_risks: topRisks.data ?? [],
      top_predictions: topPredictions.data ?? [],
      recent_simulations: recentSims.data ?? [],
      audit_samples: auditSamples.data ?? [],
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("public-intelligence error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
