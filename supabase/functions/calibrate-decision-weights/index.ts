import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FEATURE_KEYS = [
  "performance_index", "momentum_score", "risk_pressure_score",
  "systemic_fragility_score", "confidence_score", "structural_break_count",
  "anomaly_count", "alert_count", "crisis_severity_avg", "forecast_stability_score",
];

const DOMAINS = ["security", "health", "finance", "energy", "food", "governance"];

const LABEL_WEIGHTS: Record<string, number> = {
  real: 1.0, measured: 1.2, proxy: 0.35,
};

const DOMAIN_ACTION_POLICIES: Record<string, { act: number; consider: number; min_impact: number }> = {
  security: { act: 0.65, consider: 0.40, min_impact: 35 },
  health: { act: 0.70, consider: 0.45, min_impact: 40 },
  finance: { act: 0.75, consider: 0.50, min_impact: 45 },
  energy: { act: 0.70, consider: 0.45, min_impact: 40 },
  food: { act: 0.65, consider: 0.40, min_impact: 35 },
  governance: { act: 0.80, consider: 0.55, min_impact: 50 },
};

function calibrateWeights(rows: any[], existingWeights: Record<string, number>): Record<string, number> {
  if (rows.length < 10) return existingWeights;
  const newWeights: Record<string, number> = {};

  for (const key of FEATURE_KEYS) {
    let sumWXY = 0, sumWX = 0, sumWY = 0, sumWX2 = 0, sumWY2 = 0, sumW = 0;
    for (const row of rows) {
      if (row.overridden_by_real) continue;
      const x = (row.features || {})[key] ?? 0;
      const y = row.outcome_success ? 1 : 0;
      const w = LABEL_WEIGHTS[row.label_source] || 0.35;
      sumW += w; sumWX += w * x; sumWY += w * y;
      sumWXY += w * x * y; sumWX2 += w * x * x; sumWY2 += w * y * y;
    }
    if (sumW === 0) { newWeights[key] = existingWeights[key] || 0; continue; }
    const meanX = sumWX / sumW, meanY = sumWY / sumW;
    const covXY = sumWXY / sumW - meanX * meanY;
    const varX = sumWX2 / sumW - meanX * meanX;
    const varY = sumWY2 / sumW - meanY * meanY;
    if (varX < 1e-10 || varY < 1e-10) { newWeights[key] = existingWeights[key] || 0; continue; }
    const correlation = covXY / Math.sqrt(varX * varY);
    const prior = existingWeights[key] || 0;
    newWeights[key] = Math.round((correlation * 0.7 + prior * 0.3) * 1000) / 1000;
  }

  const absSum = Object.values(newWeights).reduce((s, v) => s + Math.abs(v), 0);
  if (absSum > 0) {
    for (const key of FEATURE_KEYS) newWeights[key] = Math.round((newWeights[key] / absSum) * 1000) / 1000;
  }
  return newWeights;
}

// Per-action adjustment learning
function calibrateActionAdjustments(
  rows: any[],
  existingAdj: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const actionTypes = [...new Set(rows.map(r => r.action_type).filter(Boolean))];
  const adjustments: Record<string, Record<string, number>> = { ...existingAdj };

  for (const actionType of actionTypes) {
    const actionRows = rows.filter(r => r.action_type === actionType && !r.overridden_by_real);
    if (actionRows.length < 5) continue;

    const adj: Record<string, number> = {};
    for (const key of FEATURE_KEYS) {
      const successRows = actionRows.filter(r => r.outcome_success);
      const failRows = actionRows.filter(r => r.outcome_success === false);
      if (successRows.length < 2 || failRows.length < 2) continue;

      const avgSuccess = successRows.reduce((s, r) => s + ((r.features || {})[key] || 0), 0) / successRows.length;
      const avgFail = failRows.reduce((s, r) => s + ((r.features || {})[key] || 0), 0) / failRows.length;
      const diff = avgSuccess - avgFail;
      if (Math.abs(diff) > 0.5) {
        adj[key] = Math.round(diff * 100) / 100;
      }
    }
    if (Object.keys(adj).length > 0) adjustments[actionType] = adj;
  }
  return adjustments;
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: allRows, error: fetchErr } = await supabase
      .from("decision_training_dataset")
      .select("iso3, domain, features, action_type, outcome_success, impact_score, label_source, label_confidence, overridden_by_real")
      .eq("overridden_by_real", false)
      .limit(5000);

    if (fetchErr) throw fetchErr;
    if (!allRows || allRows.length < 10) {
      return new Response(JSON.stringify({
        ok: true, message: "Insufficient training data for calibration", count: allRows?.length || 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: activeModel } = await supabase
      .from("decision_models")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentWeights = activeModel?.feature_weights || {};
    const currentActionAdj = activeModel?.action_adjustment_weights || {};

    // Calibrate global + domain + per-action
    const globalWeights = calibrateWeights(allRows, currentWeights);
    const domainWeights: Record<string, Record<string, number>> = {};
    for (const domain of DOMAINS) {
      const domainRows = allRows.filter(r => r.domain === domain);
      if (domainRows.length >= 5) domainWeights[domain] = calibrateWeights(domainRows, globalWeights);
    }
    const actionAdjustments = calibrateActionAdjustments(allRows, currentActionAdj as Record<string, Record<string, number>>);

    // Metrics
    const realRows = allRows.filter(r => r.label_source === "real" || r.label_source === "measured");
    const proxyRows = allRows.filter(r => r.label_source === "proxy");
    const measuredCount = allRows.filter(r => r.label_source === "measured").length;
    const successRate = (arr: typeof allRows) => {
      const w = arr.filter(r => r.outcome_success !== null);
      return w.length > 0 ? w.filter(r => r.outcome_success).length / w.length : null;
    };
    const avgImpact = allRows.filter(r => r.impact_score != null).length > 0
      ? allRows.filter(r => r.impact_score != null).reduce((s, r) => s + (r.impact_score || 0), 0) / allRows.filter(r => r.impact_score != null).length
      : null;

    let trainingMode = "heuristic";
    if (measuredCount > 0 && proxyRows.length > 0) trainingMode = "hybrid";
    else if (realRows.length > 0) trainingMode = "real";
    else if (proxyRows.length > 0) trainingMode = "proxy";

    const maturityRatio = allRows.length > 0
      ? (realRows.length * 1.0 + measuredCount * 1.5) / (allRows.length * 1.5) : 0;

    const versionNum = activeModel ? parseInt(activeModel.version?.split("-").pop() || "0") + 1 : 1;
    const newVersion = `DL-cal-${versionNum}`;

    if (activeModel) {
      await supabase.from("decision_models").update({ status: "superseded" }).eq("id", activeModel.id);
    }

    const { error: insertErr } = await supabase.from("decision_models").insert({
      version: newVersion,
      model_type: "weighted_scoring",
      feature_schema: { features: FEATURE_KEYS },
      feature_weights: globalWeights,
      domain_feature_weights: domainWeights,
      action_adjustment_weights: actionAdjustments,
      action_policies: { global: { act_threshold: 0.75, consider_threshold: 0.50, min_impact: 40 } },
      domain_action_policies: DOMAIN_ACTION_POLICIES,
      performance_metrics: {
        proxy_accuracy: successRate(proxyRows),
        real_accuracy: successRate(realRows),
        action_types_calibrated: Object.keys(actionAdjustments).length,
      },
      training_sample_count: allRows.length,
      training_mode: trainingMode,
      proxy_sample_count: proxyRows.length,
      real_sample_count: realRows.length,
      measured_sample_count: measuredCount,
      avg_impact_score: avgImpact,
      outcome_maturity_ratio: Math.round(maturityRatio * 100) / 100,
      last_calibrated_at: new Date().toISOString(),
      status: "active",
    });

    if (insertErr) throw insertErr;

    // Trigger model evaluation
    try {
      await supabase.functions.invoke("evaluate-decision-models", { body: {} });
    } catch (e) { console.error("Evaluation trigger failed (non-fatal):", e); }

    return new Response(JSON.stringify({
      ok: true, version: newVersion, training_mode: trainingMode,
      global_weights: globalWeights,
      domain_weights_count: Object.keys(domainWeights).length,
      action_adjustments_count: Object.keys(actionAdjustments).length,
      samples: { total: allRows.length, proxy: proxyRows.length, real: realRows.length, measured: measuredCount },
      metrics: { proxy_accuracy: successRate(proxyRows), real_accuracy: successRate(realRows), avg_impact: avgImpact },
      maturity_ratio: Math.round(maturityRatio * 100) / 100,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Calibration error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
