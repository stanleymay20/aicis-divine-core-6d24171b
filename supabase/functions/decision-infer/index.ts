import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Feature Schema ───
const FEATURE_KEYS = [
  "performance_index", "momentum_score", "risk_pressure_score",
  "systemic_fragility_score", "confidence_score", "structural_break_count",
  "anomaly_count", "alert_count", "crisis_severity_avg", "forecast_stability_score",
] as const;

const DEFAULT_WEIGHTS: Record<string, number> = {
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

const BOUNDS: Record<string, [number, number]> = {
  performance_index: [0, 100],
  momentum_score: [-50, 50],
  risk_pressure_score: [0, 100],
  systemic_fragility_score: [0, 100],
  confidence_score: [0, 100],
  structural_break_count: [0, 20],
  anomaly_count: [0, 20],
  alert_count: [0, 15],
  crisis_severity_avg: [0, 10],
  forecast_stability_score: [0, 100],
};

const ACTION_TYPES = [
  { type: "deploy_resources", label: "Deploy Additional Resources", domains: ["security", "health", "food"] },
  { type: "escalate_monitoring", label: "Escalate Monitoring", domains: ["all"] },
  { type: "diplomatic_engagement", label: "Initiate Diplomatic Engagement", domains: ["security", "governance"] },
  { type: "supply_chain_intervention", label: "Supply Chain Intervention", domains: ["food", "energy"] },
  { type: "financial_stabilization", label: "Financial Stabilization Measures", domains: ["finance"] },
  { type: "public_health_response", label: "Public Health Response", domains: ["health"] },
  { type: "infrastructure_hardening", label: "Infrastructure Hardening", domains: ["energy", "security"] },
  { type: "governance_reform", label: "Governance Reform Advisory", domains: ["governance"] },
  { type: "early_warning_broadcast", label: "Early Warning Broadcast", domains: ["all"] },
  { type: "resource_reallocation", label: "Resource Reallocation", domains: ["all"] },
];

// ─── Feature Engineering ───
interface SignalData {
  snapshots: any[];
  anomalies: any[];
  alerts: any[];
  crises: any[];
}

function buildFeatures(signals: SignalData): Record<string, number> {
  const s = signals.snapshots;
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return {
    performance_index: avg(s.map((x: any) => x.performance_index || 50)),
    momentum_score: avg(s.map((x: any) => x.momentum_score || 0)),
    risk_pressure_score: avg(s.map((x: any) => x.risk_pressure_score || 0)),
    systemic_fragility_score: avg(s.map((x: any) => x.systemic_fragility_score || 0)),
    confidence_score: avg(s.map((x: any) => x.confidence_score || 50)),
    structural_break_count: s.reduce((sum: number, x: any) => sum + (x.structural_break_count || 0), 0),
    anomaly_count: signals.anomalies.length,
    alert_count: signals.alerts.length,
    crisis_severity_avg: avg(signals.crises.map((x: any) => x.severity || 0)),
    forecast_stability_score: avg(s.map((x: any) => x.forecast_stability_score || 50)),
  };
}

// ─── Scoring ───
function normalizeFeature(key: string, value: number): number {
  const [min, max] = BOUNDS[key] || [0, 100];
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function computeRiskScore(features: Record<string, number>, weights: Record<string, number>): number {
  let score = 0;
  for (const key of FEATURE_KEYS) {
    score += normalizeFeature(key, features[key]) * (weights[key] || 0);
  }
  return Math.max(0, Math.min(100, (score + 0.5) * 100));
}

// ─── Feature Contribution ───
function computeFeatureContributions(
  features: Record<string, number>,
  weights: Record<string, number>
): Array<{ feature: string; normalized: number; weight: number; contribution: number }> {
  const contributions = FEATURE_KEYS.map(key => {
    const normalized = normalizeFeature(key, features[key]);
    const weight = weights[key] || 0;
    return { feature: key, normalized: Math.round(normalized * 1000) / 1000, weight, contribution: Math.round(normalized * weight * 1000) / 1000 };
  });
  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ─── Action Selection with adjustments ───
function selectActions(
  domain: string,
  riskScore: number,
  features: Record<string, number>,
  actionAdjustments: Record<string, Record<string, number>>,
  weights: Record<string, number>,
): Array<{
  action_type: string; label: string; success_probability: number;
  impact_estimate: number; urgency: string;
  top_drivers: Array<{ feature: string; contribution: number }>;
  domain_override: boolean; action_adjusted: boolean;
}> {
  const relevant = ACTION_TYPES.filter(a => a.domains.includes("all") || a.domains.includes(domain));
  const contributions = computeFeatureContributions(features, weights);

  return relevant.map(action => {
    let actionScore = riskScore;

    if (action.type === "deploy_resources" && features.crisis_severity_avg > 5) actionScore += 8;
    if (action.type === "escalate_monitoring" && features.anomaly_count > 5) actionScore += 10;
    if (action.type === "early_warning_broadcast" && features.structural_break_count > 3) actionScore += 12;
    if (action.type === "diplomatic_engagement" && features.risk_pressure_score > 60) actionScore += 7;
    if (action.type === "supply_chain_intervention" && features.systemic_fragility_score > 50) actionScore += 9;

    const adj = actionAdjustments[action.type];
    let actionAdjusted = false;
    if (adj) {
      for (const key of FEATURE_KEYS) {
        if (adj[key]) {
          actionScore += normalizeFeature(key, features[key]) * adj[key] * 10;
          actionAdjusted = true;
        }
      }
    }

    actionScore = Math.max(5, Math.min(95, actionScore));
    const featureRelevance = (features.risk_pressure_score + features.systemic_fragility_score) / 200;
    const impactEstimate = Math.round(Math.min(95, actionScore * 0.75 + featureRelevance * 20));

    let urgency: string;
    if (actionScore > 75) urgency = "immediate";
    else if (actionScore > 60) urgency = "24h";
    else if (actionScore > 40) urgency = "7d";
    else if (actionScore > 25) urgency = "30d";
    else urgency = "monitor";

    return {
      action_type: action.type,
      label: action.label,
      success_probability: Math.round(actionScore) / 100,
      impact_estimate: impactEstimate,
      urgency,
      top_drivers: contributions.slice(0, 3).map(c => ({ feature: c.feature, contribution: c.contribution })),
      domain_override: false,
      action_adjusted: actionAdjusted,
    };
  })
  .sort((a, b) => b.success_probability - a.success_probability)
  .slice(0, 5);
}

// ─── Policy Layer ───
function classifyAction(
  successProb: number,
  impact: number,
  domainPolicies?: Record<string, { act: number; consider: number; min_impact: number }>,
  domain?: string
): "ACT" | "CONSIDER" | "MONITOR" {
  const policy = (domain && domainPolicies?.[domain]) || { act: 0.75, consider: 0.50, min_impact: 40 };
  if (successProb >= policy.act && impact >= policy.min_impact) return "ACT";
  if (successProb >= policy.consider || impact >= (policy.min_impact * 0.8)) return "CONSIDER";
  return "MONITOR";
}

// ─── Guardrails ───
function applyGuardrails(
  recommendations: Array<any>,
  features: Record<string, number>,
  domain: string
): Array<any> {
  return recommendations
    .map(rec => {
      if (domain === "governance" && rec.policy === "ACT" && rec.success_probability < 0.80) {
        return { ...rec, policy: "CONSIDER" as const, guardrail_applied: "governance_caution" };
      }
      return { ...rec, guardrail_applied: null };
    })
    .map(rec => {
      if (rec.urgency === "immediate" && features.anomaly_count === 0 && features.crisis_severity_avg === 0) {
        return { ...rec, urgency: "24h", guardrail_applied: rec.guardrail_applied || "no_crisis_support" };
      }
      return rec;
    })
    .map(rec => {
      const signalDensity = features.anomaly_count + features.alert_count + features.crisis_severity_avg;
      if (signalDensity < 2 && rec.success_probability > 0.70) {
        return { ...rec, success_probability: 0.70, guardrail_applied: rec.guardrail_applied || "weak_signal_cap" };
      }
      return rec;
    })
    .filter((rec, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return Math.abs(rec.success_probability - prev.success_probability) > 0.02 || rec.action_type !== prev.action_type;
    });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { iso3, domain, explain, auto_capture } = await req.json().catch(() => ({}));

    const { data: activeModel } = await supabase
      .from("decision_models")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeModel) {
      return new Response(JSON.stringify({
        ok: false, recommendations: [], risk_score: 0,
        error: "No active decision model. Run calibration first.",
        decision_basis: "none", model_version: "none",
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const domainWeightsMap = activeModel.domain_feature_weights || {};
    const globalWeights = activeModel.feature_weights || DEFAULT_WEIGHTS;
    const weights = (domain && domainWeightsMap[domain]) || globalWeights;
    const domainActionPolicies = activeModel.domain_action_policies || {};
    const actionAdjustments = activeModel.action_adjustment_weights || {};
    const modelVersion = activeModel.version;
    const trainingMode = activeModel.training_mode || "heuristic";
    const domainOverrideUsed = !!(domain && domainWeightsMap[domain]);

    let snapshotQuery = supabase
      .from("country_performance_snapshots")
      .select("iso3, domain, performance_index, momentum_score, risk_pressure_score, systemic_fragility_score, confidence_score, structural_break_count, forecast_stability_score")
      .order("risk_pressure_score", { ascending: false })
      .limit(50);
    if (iso3) snapshotQuery = snapshotQuery.eq("iso3", iso3);
    if (domain) snapshotQuery = snapshotQuery.eq("domain", domain);

    const [snapshots, anomalies, alerts, crises] = await Promise.all([
      snapshotQuery,
      supabase.from("anomaly_detections").select("*").eq("status", "active").limit(20),
      supabase.from("critical_alerts").select("*").eq("acknowledged", false).limit(15),
      supabase.from("crisis_events").select("*").neq("status", "resolved").limit(10),
    ]);

    const signalData: SignalData = {
      snapshots: snapshots.data || [],
      anomalies: anomalies.data || [],
      alerts: alerts.data || [],
      crises: crises.data || [],
    };

    const totalSignals = signalData.snapshots.length + signalData.anomalies.length + signalData.alerts.length + signalData.crises.length;
    if (totalSignals < 3) {
      return new Response(JSON.stringify({
        ok: true, recommendations: [], risk_score: 0,
        decision_basis: "statistical_model", model_version: modelVersion,
        training_mode: trainingMode, outcome_trained: trainingMode === "real" || trainingMode === "hybrid",
        message: "Insufficient signal data for model-driven inference",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const features = buildFeatures(signalData);
    const riskScore = computeRiskScore(features, weights as Record<string, number>);
    const featureContributions = computeFeatureContributions(features, weights as Record<string, number>);

    const targetDomain = domain || "all";
    const rawActions = selectActions(targetDomain, riskScore, features, actionAdjustments as Record<string, Record<string, number>>, weights as Record<string, number>);
    const withPolicy = rawActions.map(a => ({
      ...a,
      policy: classifyAction(a.success_probability, a.impact_estimate, domainActionPolicies, targetDomain),
      domain_override: domainOverrideUsed,
    }));
    const recommendations = applyGuardrails(withPolicy, features, targetDomain);

    let explanation: string | null = null;
    let explanationProvider: string | null = null;
    let explanationModel: string | null = null;
    if (explain && recommendations.length > 0) {
      try {
        const topRec = recommendations[0];
        const topDrivers = featureContributions.slice(0, 3).map(c => `${c.feature}: ${c.contribution > 0 ? "+" : ""}${c.contribution}`).join(", ");
        const explainPrompt = `You are explaining a statistical decision model's output. Use only the model outputs below. Be concise (2-3 sentences). Do not add external facts and do not make a new decision.\nRisk score: ${riskScore.toFixed(1)}/100 for ${iso3 || "global"} / ${targetDomain}.\nTop recommendation: "${topRec.label}" (${(topRec.success_probability * 100).toFixed(0)} internal score).\nTop drivers: ${topDrivers}.\nExplain why the model produced this result based on these features.`;
        const llm = await aiChat({
          messages: [
            { role: "system", content: "Explain only the supplied statistical model output. Never introduce outside facts, forecasts, or new recommendations." },
            { role: "user", content: explainPrompt },
          ],
          temperature: 0.1,
          timeoutMs: 15000,
        });
        explanation = llm.content || null;
        explanationProvider = llm.provider;
        explanationModel = llm.model;
      } catch (e) {
        console.error("LLM explain error (non-fatal):", e);
      }
    }

    const canonicalInput = JSON.stringify({ features, weights, modelVersion, trainingMode }, Object.keys({ features, weights, modelVersion, trainingMode }).sort());
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalInput));
    const inferenceHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    const signalCounts = {
      snapshots: signalData.snapshots.length,
      anomalies: signalData.anomalies.length,
      alerts: signalData.alerts.length,
      crises: signalData.crises.length,
    };

    const auditOps: Promise<any>[] = [
      supabase.from("decision_inference_audit").insert({
        model_version: modelVersion, training_mode: trainingMode,
        scope_iso3: iso3 || null, scope_domain: domain || "all",
        feature_vector: features, weights_used: weights,
        risk_score: riskScore,
        chosen_actions: recommendations.map(r => ({ action_type: r.action_type, success_probability: r.success_probability })),
        policy_classifications: recommendations.map(r => ({ action_type: r.action_type, policy: r.policy, guardrail: r.guardrail_applied })),
        signal_counts: signalCounts, inference_hash: inferenceHash,
        guardrail_flags: recommendations.filter(r => r.guardrail_applied).map(r => ({ action: r.action_type, guardrail: r.guardrail_applied })),
      }),
      supabase.from("ai_decision_logs").insert({
        division_key: domain || "system",
        model_name: modelVersion,
        input_summary: `Model inference for ${iso3 || "global"} / ${targetDomain} | ${totalSignals} signals`,
        output_summary: `Risk: ${riskScore.toFixed(1)} | Top: ${recommendations[0]?.label} (${((recommendations[0]?.success_probability || 0) * 100).toFixed(0)} internal score)`,
        confidence: (recommendations[0]?.success_probability || 0) * 100,
        explanation: {
          features,
          risk_score: riskScore,
          model_version: modelVersion,
          training_mode: trainingMode,
          inference_hash: inferenceHash,
          feature_contributions: featureContributions.slice(0, 5),
          narrative_provider: explanationProvider,
          narrative_model: explanationModel,
          score_semantics: trainingMode === "real" || trainingMode === "hybrid" ? "model_score_with_outcome_training" : "internal_decision_score_not_empirical_probability",
        },
      }),
    ];

    if (auto_capture && recommendations.length > 0) {
      const topRec = recommendations[0];
      const slaHours = topRec.policy === "ACT" ? 24 : topRec.policy === "CONSIDER" ? 72 : 168;
      const capturePayload = {
        signal_id: `infer-${Date.now()}`,
        signal_title: `${topRec.label} — ${iso3 || "Global"} / ${targetDomain}`,
        signal_date: new Date().toISOString().split("T")[0],
        domain: domain || "system",
        iso3: iso3 || null,
        action_type: topRec.action_type,
        signal_confidence: Math.round(topRec.success_probability * 100),
        hypothetical_decision_value: String(topRec.impact_estimate),
        decision_features: features,
        evidence_type: "pilot",
        review_status: "pending",
        review_sla_hours: slaHours,
        review_due_at: new Date(Date.now() + slaHours * 3600000).toISOString(),
        execution_status: "not_started",
      };
      const { error: captureError } = await supabase.from("decision_outcome_log").insert(capturePayload);
      if (captureError) console.error("Auto-capture insert error:", captureError);
    }

    await Promise.all(auditOps);

    return new Response(JSON.stringify({
      ok: true,
      risk_score: Math.round(riskScore * 10) / 10,
      features,
      feature_contributions: featureContributions,
      recommendations,
      explanation,
      explanation_provider: explanationProvider,
      explanation_model: explanationModel,
      decision_basis: "statistical_model",
      model_version: modelVersion,
      training_mode: trainingMode,
      outcome_trained: trainingMode === "real" || trainingMode === "hybrid",
      score_semantics: trainingMode === "real" || trainingMode === "hybrid" ? "model_score_with_outcome_training" : "internal_decision_score_not_empirical_probability",
      domain_override_used: domainOverrideUsed,
      action_adjustments_available: Object.keys(actionAdjustments).length,
      training_samples: activeModel?.training_sample_count || 0,
      real_samples: activeModel?.real_sample_count || 0,
      proxy_samples: activeModel?.proxy_sample_count || 0,
      inference_hash: inferenceHash,
      signal_counts: signalCounts,
      generated_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Decision infer error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
