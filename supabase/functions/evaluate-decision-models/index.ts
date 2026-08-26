import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Heuristic baseline weights (frozen reference)
const HEURISTIC_WEIGHTS: Record<string, number> = {
  performance_index: -0.15,
  momentum_score: -0.10,
  risk_pressure_score: 0.25,
  systemic_fragility_score: 0.20,
  confidence_score: 0.05,
  structural_break_count: 0.10,
  anomaly_count: 0.10,
  alert_count: 0.10,
  crisis_severity_avg: 0.10,
  forecast_stability_score: -0.05,
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Get active + previous models
    const { data: models } = await supabase
      .from("decision_models")
      .select("id, version, status, training_mode, feature_weights, training_sample_count, proxy_sample_count, real_sample_count, measured_sample_count")
      .in("status", ["active", "superseded"])
      .order("created_at", { ascending: false })
      .limit(2);

    const activeModel = models?.find(m => m.status === "active");
    const previousModel = models?.find(m => m.status === "superseded");

    if (!activeModel) {
      return new Response(JSON.stringify({ ok: true, message: "No active model to evaluate" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load training dataset
    const { data: trainingData } = await supabase
      .from("decision_training_dataset")
      .select("label_source, outcome_success, impact_score")
      .eq("overridden_by_real", false)
      .limit(5000);

    const rows = trainingData || [];
    const proxyRows = rows.filter(r => r.label_source === "proxy");
    const realRows = rows.filter(r => r.label_source === "real" || r.label_source === "measured");
    const measuredRows = rows.filter(r => r.label_source === "measured");

    const successRate = (arr: typeof rows) => {
      const withOutcome = arr.filter(r => r.outcome_success !== null);
      return withOutcome.length > 0 ? withOutcome.filter(r => r.outcome_success).length / withOutcome.length : null;
    };

    // 3. Load outcome log for acceptance + ROI tracking
    const { data: outcomes } = await supabase
      .from("decision_outcome_log")
      .select("recommendation_accepted, outcome_success, impact_score, evidence_type, signal_confidence, roi_estimate, net_value")
      .not("action_type", "is", null)
      .limit(2000);

    const outcomeRows = outcomes || [];
    const withAcceptance = outcomeRows.filter(r => r.recommendation_accepted !== null);
    const acceptanceRate = withAcceptance.length > 0
      ? withAcceptance.filter(r => r.recommendation_accepted).length / withAcceptance.length
      : null;

    // ROI metrics
    const withROI = outcomeRows.filter(r => r.roi_estimate != null);
    const avgROI = withROI.length > 0 ? withROI.reduce((s, r) => s + (r.roi_estimate || 0), 0) / withROI.length : null;
    const totalNetValue = outcomeRows.filter(r => r.net_value != null).reduce((s, r) => s + (r.net_value || 0), 0) || null;

    // 4. Confidence calibration (ECE)
    const buckets: Record<string, { predicted: number; actual: number; count: number }> = {};
    for (const row of outcomeRows) {
      if (row.signal_confidence == null || row.outcome_success == null) continue;
      const bucket = `${Math.floor(row.signal_confidence / 10) * 10}-${Math.floor(row.signal_confidence / 10) * 10 + 10}`;
      if (!buckets[bucket]) buckets[bucket] = { predicted: 0, actual: 0, count: 0 };
      buckets[bucket].count++;
      buckets[bucket].predicted += row.signal_confidence / 100;
      buckets[bucket].actual += row.outcome_success ? 1 : 0;
    }

    let calibrationError: number | null = null;
    const bucketEntries = Object.values(buckets);
    if (bucketEntries.length > 0) {
      const totalSamples = bucketEntries.reduce((s, b) => s + b.count, 0);
      calibrationError = bucketEntries.reduce((ece, b) => {
        const avgPred = b.predicted / b.count;
        const avgActual = b.actual / b.count;
        return ece + (b.count / totalSamples) * Math.abs(avgPred - avgActual);
      }, 0);
      calibrationError = Math.round(calibrationError * 1000) / 1000;
    }

    // 5. ACT/CONSIDER precision from inference audit
    const { data: recentInferences } = await supabase
      .from("decision_inference_audit")
      .select("policy_classifications, model_version")
      .eq("model_version", activeModel.version)
      .limit(200);

    let actCount = 0, considerCount = 0;
    for (const inf of recentInferences || []) {
      const policies = inf.policy_classifications as Array<{ policy: string }> || [];
      for (const p of policies) {
        if (p.policy === "ACT") actCount++;
        if (p.policy === "CONSIDER") considerCount++;
      }
    }

    // 6. Baseline comparison — heuristic success rate
    // Simulate: for each training row with features, compute heuristic score and check if heuristic would agree
    const { data: featuredRows } = await supabase
      .from("decision_training_dataset")
      .select("features, outcome_success")
      .eq("overridden_by_real", false)
      .not("outcome_success", "is", null)
      .limit(2000);

    let heuristicSuccessRate: number | null = null;
    if (featuredRows && featuredRows.length > 10) {
      let heuristicCorrect = 0;
      for (const row of featuredRows) {
        const feats = row.features as Record<string, number> || {};
        // Heuristic: compute weighted score using default weights, predict success if score < 50
        let hScore = 0;
        for (const [k, w] of Object.entries(HEURISTIC_WEIGHTS)) {
          const val = feats[k] || 0;
          const bounds: Record<string, [number, number]> = {
            performance_index: [0, 100], momentum_score: [-50, 50], risk_pressure_score: [0, 100],
            systemic_fragility_score: [0, 100], confidence_score: [0, 100], structural_break_count: [0, 20],
            anomaly_count: [0, 20], alert_count: [0, 15], crisis_severity_avg: [0, 10], forecast_stability_score: [0, 100],
          };
          const [min, max] = bounds[k] || [0, 100];
          const norm = Math.max(0, Math.min(1, (val - min) / (max - min)));
          hScore += norm * w;
        }
        const hRiskScore = Math.max(0, Math.min(100, (hScore + 0.5) * 100));
        const heuristicPredictSuccess = hRiskScore < 55;
        if (heuristicPredictSuccess === row.outcome_success) heuristicCorrect++;
      }
      heuristicSuccessRate = Math.round(heuristicCorrect / featuredRows.length * 1000) / 1000;
    }

    // Model success rate for comparison
    const modelSuccessRate = successRate(rows);
    const prevModelRate = previousModel ? successRate(proxyRows) : null; // approximate

    const improvementOverHeuristic = (modelSuccessRate != null && heuristicSuccessRate != null)
      ? Math.round((modelSuccessRate - heuristicSuccessRate) * 1000) / 10
      : null;

    const improvementOverPrevious = (modelSuccessRate != null && prevModelRate != null)
      ? Math.round((modelSuccessRate - prevModelRate) * 1000) / 10
      : null;

    // 7. Store evaluation
    const evaluation = {
      model_version: activeModel.version,
      compared_to_version: previousModel?.version || null,
      evaluation_type: "periodic",
      proxy_success_rate: successRate(proxyRows),
      real_success_rate: successRate(realRows),
      measured_success_rate: successRate(measuredRows),
      avg_impact_score: rows.filter(r => r.impact_score != null).length > 0
        ? Math.round(rows.filter(r => r.impact_score != null).reduce((s, r) => s + (r.impact_score || 0), 0) / rows.filter(r => r.impact_score != null).length * 10) / 10
        : null,
      acceptance_rate: acceptanceRate,
      act_precision: actCount,
      consider_precision: considerCount,
      calibration_error: calibrationError,
      confidence_buckets: buckets,
      sample_count: rows.length,
      heuristic_success_rate: heuristicSuccessRate,
      improvement_over_previous: improvementOverPrevious,
      improvement_over_heuristic: improvementOverHeuristic,
      avg_roi: avgROI ? Math.round(avgROI * 10) / 10 : null,
      total_net_value: totalNetValue ? Math.round(totalNetValue * 10) / 10 : null,
      metadata: {
        active_model: activeModel.version,
        previous_model: previousModel?.version,
        outcome_log_count: outcomeRows.length,
        inference_count: recentInferences?.length || 0,
        roi_samples: withROI.length,
      },
    };

    const { error: insertErr } = await supabase.from("model_evaluations").insert(evaluation);
    if (insertErr) throw insertErr;

    // Check promotion status — flag if model underperforms
    let promotionAdvice = "ok";
    if (improvementOverHeuristic != null && improvementOverHeuristic < -5) {
      promotionAdvice = "reject: underperforms heuristic by " + Math.abs(improvementOverHeuristic).toFixed(1) + "%";
      // Update model promotion_status
      await supabase.from("decision_models")
        .update({ promotion_status: "flagged", rejection_reason: promotionAdvice })
        .eq("version", activeModel.version);
    }

    return new Response(JSON.stringify({ ok: true, evaluation, promotion_advice: promotionAdvice }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Model evaluation error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
