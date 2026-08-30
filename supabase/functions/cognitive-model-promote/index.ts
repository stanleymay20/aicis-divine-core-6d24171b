import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminUser } from "../_shared/auth.ts";

const FN = "cognitive-model-promote";
const PROMOTION_POLICY = "baseline-gate-v3-verified-outcomes-explicit-confirmation";
const REQUIRED_EVALUATION_METHOD = "externally_verified_target_resolution_probability_metrics_v3";
const REQUIRED_EVIDENCE_POLICY = "external_verified_target_resolution_v1";
const REQUIRED_EVALUATION_SCOPE = "model_domain_modality_task";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PromotionRequest = {
  challenger_model_id: string;
  baseline_model_id: string;
  domain?: string;
  modality: string;
  task: string;
  high_consequence?: boolean;
  minimum_relative_brier_improvement?: number;
  maximum_calibration_regression?: number;
  confirm_promotion?: boolean;
};

type RegistryRow = {
  id: string;
  model_key: string;
  version: string;
  production_approved: boolean;
  metadata: Record<string, unknown> | null;
};

type CompetencyRow = {
  model_id: string;
  sample_size: number;
  verified_sample_size: number | null;
  brier_score: number | string | null;
  brier_score_semantics: string | null;
  ece: number | string | null;
  ece_semantics: string | null;
  evaluation_status: string | null;
  evaluation_method: string | null;
  evaluation_evidence_policy: string | null;
  evaluation_scope: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminUser(req, cors);
  if (auth.response) return auth.response;

  try {
    const body = (await req.json()) as PromotionRequest;
    if (!body.challenger_model_id || !body.baseline_model_id || !body.modality || !body.task) {
      throw new Error("challenger_model_id, baseline_model_id, modality and task are required");
    }
    if (body.challenger_model_id === body.baseline_model_id) {
      throw new Error("challenger and baseline must be different models");
    }
    validatePolicyThresholds(body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const domain = body.domain ?? "general";

    const { data: registryData, error: registryError } = await supabase
      .from("aicis_model_registry")
      .select("id,model_key,version,production_approved,metadata")
      .in("id", [body.challenger_model_id, body.baseline_model_id]);
    if (registryError) throw registryError;

    const registry = (registryData ?? []) as RegistryRow[];
    const challenger = registry.find((row) => row.id === body.challenger_model_id);
    const baseline = registry.find((row) => row.id === body.baseline_model_id);
    if (!challenger || !baseline) throw new Error("challenger or baseline model not found");
    if (baseline.metadata?.role !== "baseline") {
      throw new Error("baseline_model_id must reference a registered baseline model");
    }

    const { data: competencyData, error: competencyError } = await supabase
      .from("aicis_model_competency")
      .select(
        "model_id,sample_size,verified_sample_size,brier_score,brier_score_semantics,ece,ece_semantics,evaluation_status,evaluation_method,evaluation_evidence_policy,evaluation_scope",
      )
      .in("model_id", [challenger.id, baseline.id])
      .eq("domain", domain)
      .eq("modality", body.modality)
      .eq("task", body.task);
    if (competencyError) throw competencyError;

    const competency = (competencyData ?? []) as CompetencyRow[];
    const challengerMetric = competency.find((row) => row.model_id === challenger.id);
    const baselineMetric = competency.find((row) => row.model_id === baseline.id);
    if (!challengerMetric || !baselineMetric) {
      throw new Error("both challenger and baseline require matching competency evaluations");
    }

    const minimumSamples = body.high_consequence ? 250 : 75;
    const minimumBrierImprovement = body.minimum_relative_brier_improvement ?? 0.05;
    const maximumCalibrationRegression = body.maximum_calibration_regression ?? 0.01;
    const reasons: string[] = [];

    if (!hasRecognizedVerifiedEvaluation(challengerMetric)) {
      reasons.push("challenger lacks the recognized externally verified target-resolution evaluation contract");
    }
    if (!hasRecognizedVerifiedEvaluation(baselineMetric)) {
      reasons.push("baseline lacks the recognized externally verified target-resolution evaluation contract");
    }

    const challengerVerifiedSamples = integerNonNegativeOrNull(challengerMetric.verified_sample_size);
    const baselineVerifiedSamples = integerNonNegativeOrNull(baselineMetric.verified_sample_size);
    if (challengerVerifiedSamples === null || challengerVerifiedSamples !== challengerMetric.sample_size) {
      reasons.push("challenger sample_size is not proven equal to verified_sample_size");
    }
    if (baselineVerifiedSamples === null || baselineVerifiedSamples !== baselineMetric.sample_size) {
      reasons.push("baseline sample_size is not proven equal to verified_sample_size");
    }
    if ((challengerVerifiedSamples ?? 0) < minimumSamples) {
      reasons.push(`insufficient verified challenger sample size ${challengerVerifiedSamples ?? 0}/${minimumSamples}`);
    }
    if ((baselineVerifiedSamples ?? 0) < minimumSamples) {
      reasons.push(`insufficient verified baseline sample size ${baselineVerifiedSamples ?? 0}/${minimumSamples}`);
    }

    if (
      challengerMetric.evaluation_method !== baselineMetric.evaluation_method ||
      challengerMetric.evaluation_evidence_policy !== baselineMetric.evaluation_evidence_policy ||
      challengerMetric.evaluation_scope !== baselineMetric.evaluation_scope ||
      challengerMetric.brier_score_semantics !== baselineMetric.brier_score_semantics ||
      challengerMetric.ece_semantics !== baselineMetric.ece_semantics
    ) {
      reasons.push("challenger and baseline metrics are not method/evidence/scope/semantics comparable");
    }

    const baselineBrier = numericNonNegativeOrNull(baselineMetric.brier_score);
    const challengerBrier = numericNonNegativeOrNull(challengerMetric.brier_score);
    let relativeBrierImprovement: number | null = null;
    if (baselineBrier === null || challengerBrier === null || baselineBrier <= 0) {
      reasons.push("comparable externally verified Brier evidence is unavailable");
    } else {
      relativeBrierImprovement = (baselineBrier - challengerBrier) / baselineBrier;
      if (relativeBrierImprovement < minimumBrierImprovement) {
        reasons.push(
          `Brier improvement ${(relativeBrierImprovement * 100).toFixed(1)}% is below policy threshold ${(minimumBrierImprovement * 100).toFixed(1)}%`,
        );
      }
    }

    const baselineEce = numericUnitOrNull(baselineMetric.ece);
    const challengerEce = numericUnitOrNull(challengerMetric.ece);
    let calibrationImprovement: number | null = null;
    if (baselineEce === null || challengerEce === null) {
      reasons.push("comparable externally verified ECE evidence is unavailable");
    } else {
      calibrationImprovement = baselineEce - challengerEce;
      if (calibrationImprovement < -maximumCalibrationRegression) {
        reasons.push(`calibration regressed by ${Math.abs(calibrationImprovement).toFixed(4)}`);
      }
    }

    const eligible = reasons.length === 0;
    const confirmationRequested = body.confirm_promotion === true;
    const promoted = eligible && confirmationRequested;

    if (promoted && !challenger.production_approved) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("aicis_model_registry")
        .update({
          production_approved: true,
          updated_at: now,
          metadata: {
            ...(challenger.metadata ?? {}),
            promoted_against: baseline.model_key,
            promoted_domain: domain,
            promoted_modality: body.modality,
            promoted_task: body.task,
            promoted_at: now,
            promotion_policy: PROMOTION_POLICY,
            evaluation_method: REQUIRED_EVALUATION_METHOD,
            evaluation_evidence_policy: REQUIRED_EVIDENCE_POLICY,
            evaluation_scope: REQUIRED_EVALUATION_SCOPE,
            verified_sample_size: challengerVerifiedSamples,
            explicit_admin_confirmation: true,
            minimum_relative_brier_improvement_policy: minimumBrierImprovement,
            maximum_calibration_regression_policy: maximumCalibrationRegression,
          },
        })
        .eq("id", challenger.id);
      if (updateError) throw updateError;
    }

    const now = new Date().toISOString();
    await supabase.from("aicis_cognitive_events").insert({
      event_type: promoted ? "model.promoted" : "model.promotion_evaluated",
      epistemic_status: "derived",
      confidence: null,
      confidence_semantics: "not_issued_promotion_policy_decision_is_not_epistemic_confidence",
      occurred_at: now,
      observed_at: now,
      time_semantics: "promotion_evaluation_time",
      producer: FN,
      payload: {
        challenger_model_id: challenger.id,
        challenger_model_key: challenger.model_key,
        baseline_model_id: baseline.id,
        baseline_model_key: baseline.model_key,
        domain,
        modality: body.modality,
        task: body.task,
        high_consequence: Boolean(body.high_consequence),
        challenger_verified_sample_size: challengerVerifiedSamples,
        baseline_verified_sample_size: baselineVerifiedSamples,
        relative_brier_improvement: relativeBrierImprovement,
        calibration_improvement: calibrationImprovement,
        eligible,
        confirmation_requested: confirmationRequested,
        promoted,
        promotion_policy: PROMOTION_POLICY,
        required_evaluation_method: REQUIRED_EVALUATION_METHOD,
        required_evidence_policy: REQUIRED_EVIDENCE_POLICY,
        required_evaluation_scope: REQUIRED_EVALUATION_SCOPE,
        threshold_semantics: "operator_policy_thresholds_not_statistical_significance",
        reasons,
      },
      provenance: [],
    });

    return new Response(JSON.stringify({
      eligible,
      confirmation_required: eligible && !confirmationRequested,
      confirmation_requested: confirmationRequested,
      promoted,
      challenger: `${challenger.model_key}@${challenger.version}`,
      baseline: `${baseline.model_key}@${baseline.version}`,
      challenger_verified_sample_size: challengerVerifiedSamples,
      baseline_verified_sample_size: baselineVerifiedSamples,
      relative_brier_improvement: relativeBrierImprovement,
      calibration_improvement: calibrationImprovement,
      promotion_policy: PROMOTION_POLICY,
      required_evaluation_method: REQUIRED_EVALUATION_METHOD,
      required_evidence_policy: REQUIRED_EVIDENCE_POLICY,
      required_evaluation_scope: REQUIRED_EVALUATION_SCOPE,
      threshold_semantics: "operator_policy_thresholds_not_statistical_significance",
      reasons,
    }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "model promotion failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});

function validatePolicyThresholds(body: PromotionRequest): void {
  if (
    body.minimum_relative_brier_improvement !== undefined &&
    (!Number.isFinite(body.minimum_relative_brier_improvement) || body.minimum_relative_brier_improvement < -1 || body.minimum_relative_brier_improvement > 1)
  ) {
    throw new Error("minimum_relative_brier_improvement must be finite between -1 and 1");
  }
  if (
    body.maximum_calibration_regression !== undefined &&
    (!Number.isFinite(body.maximum_calibration_regression) || body.maximum_calibration_regression < 0 || body.maximum_calibration_regression > 1)
  ) {
    throw new Error("maximum_calibration_regression must be finite between 0 and 1");
  }
}

function hasRecognizedVerifiedEvaluation(row: CompetencyRow): boolean {
  return row.evaluation_method === REQUIRED_EVALUATION_METHOD &&
    row.evaluation_evidence_policy === REQUIRED_EVIDENCE_POLICY &&
    row.evaluation_scope === REQUIRED_EVALUATION_SCOPE &&
    row.evaluation_status !== null &&
    (
      row.evaluation_status === "partial_externally_verified_probabilistic_evaluation" ||
      row.evaluation_status === "externally_verified_probabilistic_outcomes_evaluated_v3"
    ) &&
    hasExactMetricSemantics(row.brier_score_semantics, "externally_verified_target_resolved_binary_outcomes") &&
    hasExactMetricSemantics(row.ece_semantics, "externally_verified_target_resolved_binary_outcomes");
}

function hasExactMetricSemantics(value: string | null, requiredMarker: string): boolean {
  return Boolean(value && value.includes(requiredMarker));
}

function numericNonNegativeOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function integerNonNegativeOrNull(value: number | string | null): number | null {
  const numeric = numericNonNegativeOrNull(value);
  return numeric !== null && Number.isInteger(numeric) ? numeric : null;
}

function numericUnitOrNull(value: number | string | null): number | null {
  const numeric = numericNonNegativeOrNull(value);
  return numeric !== null && numeric <= 1 ? numeric : null;
}
