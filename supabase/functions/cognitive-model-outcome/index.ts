import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

type OutcomeRequest = {
  prediction_id: string;
  observed_outcome: Record<string, unknown>;
  observed_at: string;
  binary_outcome?: 0 | 1;
  absolute_error?: number;
  absolute_error_semantics?: string;
  evidence_claim_id?: string;
};

type RouteContext = {
  domain: string;
  modality: string;
};

type VerifiedResolution = {
  id: string;
  prediction_id: string;
  external_outcome_id: string;
  resolved_binary_outcome: 0 | 1 | number | null;
  resolution_status: string;
  target_definition: string;
  target_semantics: string;
  target_version: string;
  resolution_rule: string;
  resolution_rule_version: string;
  resolved_at: string | null;
};

type ExternalOutcome = {
  id: string;
  prediction_system: string;
  prediction_id: string;
  observed_at: string;
  verification_status: string;
  verification_method: string | null;
  verified_at: string | null;
};

type EligibleEvaluationRow = {
  probability: number | string | null;
  probability_semantics: string | null;
  binary_outcome: 0 | 1 | number | null;
};

const BRIER_SEMANTICS = "mean_squared_probability_error_on_externally_verified_target_resolved_binary_outcomes";
const ECE_SEMANTICS = "ten_equal_width_bin_expected_calibration_error_on_externally_verified_target_resolved_binary_outcomes";
const EVALUATION_METHOD = "externally_verified_target_resolution_probability_metrics_v3";
const EVIDENCE_POLICY = "external_verified_target_resolution_v1";
const EVALUATION_SCOPE = "model_domain_modality_task";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as OutcomeRequest;
    if (!body.prediction_id || !body.observed_outcome || !body.observed_at) {
      throw new Error("prediction_id, observed_outcome and observed_at are required");
    }
    if (!Number.isFinite(Date.parse(body.observed_at))) {
      throw new Error("observed_at must be a valid timestamp");
    }
    if (body.absolute_error !== undefined && (!Number.isFinite(body.absolute_error) || body.absolute_error < 0)) {
      throw new Error("absolute_error must be a finite non-negative number when supplied");
    }
    if (body.absolute_error !== undefined && !body.absolute_error_semantics?.trim()) {
      throw new Error("absolute_error_semantics is required when absolute_error is supplied");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: prediction, error: predictionError } = await supabase
      .from("aicis_model_predictions")
      .select("id,model_id,routing_decision_id,probability,probability_semantics,task,metadata")
      .eq("id", body.prediction_id)
      .single();
    if (predictionError) throw predictionError;

    const candidateBinary = body.binary_outcome === 0 || body.binary_outcome === 1
      ? body.binary_outcome
      : null;
    const probability = numericUnitOrNull(prediction.probability);
    const probabilityUsable = probability !== null && isProbabilitySemantics(prediction.probability_semantics);

    // A caller-supplied binary label is only a candidate. Evaluation truth must
    // come from the dedicated target-resolution ledger and currently verified
    // external evidence.
    const { data: resolutionData, error: resolutionError } = await supabase
      .from("aicis_model_outcome_resolutions")
      .select(
        "id,prediction_id,external_outcome_id,resolved_binary_outcome,resolution_status,target_definition,target_semantics,target_version,resolution_rule,resolution_rule_version,resolved_at",
      )
      .eq("prediction_system", "model_cortex")
      .eq("prediction_id", prediction.id)
      .eq("resolution_status", "verified")
      .maybeSingle();
    if (resolutionError) throw resolutionError;

    const resolution = (resolutionData ?? null) as VerifiedResolution | null;
    let externalOutcome: ExternalOutcome | null = null;
    if (resolution) {
      const { data: externalData, error: externalError } = await supabase
        .from("prediction_external_outcomes")
        .select("id,prediction_system,prediction_id,observed_at,verification_status,verification_method,verified_at")
        .eq("id", resolution.external_outcome_id)
        .maybeSingle();
      if (externalError) throw externalError;
      externalOutcome = (externalData ?? null) as ExternalOutcome | null;
    }

    const verifiedResolutionUsable = isUsableVerifiedResolution(
      resolution,
      externalOutcome,
      prediction.id,
    );
    const verifiedBinary = verifiedResolutionUsable
      ? binaryOutcomeOrNull(resolution?.resolved_binary_outcome ?? null)
      : null;

    if (candidateBinary !== null && verifiedBinary !== null && candidateBinary !== verifiedBinary) {
      throw new Error(
        `candidate binary_outcome ${candidateBinary} conflicts with verified target resolution ${verifiedBinary}`,
      );
    }

    const brier = verifiedBinary === null || !probabilityUsable
      ? null
      : (probability - verifiedBinary) ** 2;
    const evidenceEligible = verifiedBinary !== null && resolution !== null && externalOutcome !== null;
    const effectiveObservedAt = evidenceEligible ? externalOutcome.observed_at : body.observed_at;
    const evidenceStatus = evidenceEligible
      ? "externally_verified_target_resolved"
      : candidateBinary !== null
        ? "candidate_outcome_not_evaluation_eligible"
        : "outcome_recorded_without_verified_target_resolution";

    const { error: outcomeError } = await supabase.from("aicis_model_outcomes").upsert({
      prediction_id: prediction.id,
      observed_outcome: body.observed_outcome,
      candidate_binary_outcome: candidateBinary,
      binary_outcome: verifiedBinary,
      observed_at: effectiveObservedAt,
      brier_score: brier,
      brier_score_semantics: brier === null ? null : BRIER_SEMANTICS,
      absolute_error: body.absolute_error ?? null,
      absolute_error_semantics: body.absolute_error !== undefined
        ? body.absolute_error_semantics?.trim()
        : null,
      evidence_claim_id: body.evidence_claim_id ?? null,
      evidence_status: evidenceStatus,
      resolution_id: evidenceEligible ? resolution.id : null,
      evaluation_eligibility: evidenceEligible ? EVIDENCE_POLICY : "blocked_missing_verified_target_resolution",
      evaluation_block_reason: evidenceEligible
        ? (probabilityUsable ? null : "prediction_probability_not_usable_for_probabilistic_evaluation")
        : "no_current_external_verified_target_resolution",
    }, { onConflict: "prediction_id" });
    if (outcomeError) throw outcomeError;

    let route: RouteContext | null = null;
    if (prediction.routing_decision_id) {
      const { data: routeData, error: routeError } = await supabase
        .from("aicis_model_routing_decisions")
        .select("domain,modality")
        .eq("id", prediction.routing_decision_id)
        .maybeSingle();
      if (routeError) throw routeError;
      route = (routeData ?? null) as RouteContext | null;
    }

    let pairs: Array<{ probability: number; outcome: 0 | 1 }> = [];
    if (route) {
      const { data: eligibleRows, error: eligibleError } = await supabase
        .from("aicis_verified_model_outcome_evaluations")
        .select("probability,probability_semantics,binary_outcome")
        .eq("model_id", prediction.model_id)
        .eq("task", prediction.task)
        .eq("domain", route.domain)
        .eq("modality", route.modality)
        .limit(5000);
      if (eligibleError) throw eligibleError;

      pairs = ((eligibleRows ?? []) as EligibleEvaluationRow[])
        .map((row) => ({
          probability: numericUnitOrNull(row.probability),
          semantics: row.probability_semantics,
          outcome: binaryOutcomeOrNull(row.binary_outcome),
        }))
        .filter((row): row is { probability: number; semantics: string | null; outcome: 0 | 1 } =>
          row.probability !== null && row.outcome !== null && isProbabilitySemantics(row.semantics)
        )
        .map((row) => ({ probability: row.probability, outcome: row.outcome }));
    }

    const meanBrier = pairs.length > 0
      ? pairs.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0) / pairs.length
      : null;
    const ece = pairs.length >= 30 ? expectedCalibrationError(pairs, 10) : null;
    const evaluationStatus = !route
      ? "routing_scope_unavailable"
      : pairs.length === 0
        ? "no_externally_verified_target_resolved_probability_pairs"
        : ece === null
          ? "partial_externally_verified_probabilistic_evaluation"
          : "externally_verified_probabilistic_outcomes_evaluated_v3";

    let competencyUpdated = false;
    if (route) {
      // Always refresh/clear the direct metrics for this exact scope. If evidence
      // is later rejected or superseded, the canonical view shrinks and stale
      // competency evidence must not survive merely because the new sample is 0.
      const { error: competencyUpdateError } = await supabase
        .from("aicis_model_competency")
        .update({
          sample_size: pairs.length,
          verified_sample_size: pairs.length,
          brier_score: meanBrier,
          brier_score_semantics: meanBrier === null ? null : BRIER_SEMANTICS,
          ece,
          ece_semantics: ece === null ? null : ECE_SEMANTICS,
          evaluation_status: evaluationStatus,
          evaluation_method: EVALUATION_METHOD,
          evaluation_evidence_policy: EVIDENCE_POLICY,
          evaluation_scope: EVALUATION_SCOPE,
          evaluated_at: new Date().toISOString(),
        })
        .eq("model_id", prediction.model_id)
        .eq("domain", route.domain)
        .eq("modality", route.modality)
        .eq("task", prediction.task);
      if (competencyUpdateError) throw competencyUpdateError;
      competencyUpdated = true;
    }

    return new Response(
      JSON.stringify({
        recorded: true,
        candidate_binary_outcome: candidateBinary,
        verified_binary_outcome: verifiedBinary,
        external_target_resolution_usable: verifiedResolutionUsable,
        evaluation_evidence_policy: EVIDENCE_POLICY,
        prediction_probability_usable: probabilityUsable,
        brier_score: brier,
        brier_score_semantics: brier === null ? null : BRIER_SEMANTICS,
        verified_probability_sample_size: pairs.length,
        mean_brier_score: meanBrier,
        ece,
        ece_semantics: ece === null ? null : ECE_SEMANTICS,
        evaluation_status: evaluationStatus,
        evaluation_method: EVALUATION_METHOD,
        evaluation_scope: EVALUATION_SCOPE,
        generic_competence_updated: false,
        generic_calibration_updated: false,
        generic_reliability_updated: false,
        competency_record_updated_with_direct_metrics: competencyUpdated,
      }),
      { headers: { ...cors, "content-type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "outcome learning failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});

function isUsableVerifiedResolution(
  resolution: VerifiedResolution | null,
  externalOutcome: ExternalOutcome | null,
  predictionId: string,
): boolean {
  if (!resolution || !externalOutcome) return false;
  const binary = binaryOutcomeOrNull(resolution.resolved_binary_outcome);
  if (binary === null) return false;
  if (resolution.resolution_status !== "verified") return false;
  if (!resolution.target_definition?.trim() || !resolution.target_semantics?.trim()) return false;
  if (!resolution.target_version?.trim() || !resolution.resolution_rule?.trim()) return false;
  if (!resolution.resolution_rule_version?.trim() || !resolution.resolved_at) return false;
  if (externalOutcome.verification_status !== "verified") return false;
  if (!externalOutcome.verified_at || !externalOutcome.verification_method?.trim()) return false;
  if (externalOutcome.prediction_system !== "model_cortex") return false;
  if (externalOutcome.prediction_id !== predictionId || resolution.prediction_id !== predictionId) return false;
  if (Date.parse(resolution.resolved_at) < Date.parse(externalOutcome.observed_at)) return false;
  return true;
}

function expectedCalibrationError(
  rows: Array<{ probability: number; outcome: 0 | 1 }>,
  binCount: number,
): number {
  let weightedError = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    const lower = bin / binCount;
    const upper = (bin + 1) / binCount;
    const inBin = rows.filter((row) =>
      bin === binCount - 1
        ? row.probability >= lower && row.probability <= upper
        : row.probability >= lower && row.probability < upper
    );
    if (inBin.length === 0) continue;
    const meanProbability = inBin.reduce((sum, row) => sum + row.probability, 0) / inBin.length;
    const empiricalRate = inBin.reduce((sum, row) => sum + row.outcome, 0) / inBin.length;
    weightedError += (inBin.length / rows.length) * Math.abs(meanProbability - empiricalRate);
  }
  return weightedError;
}

function isProbabilitySemantics(semantics: string | null): boolean {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  if (
    normalized.includes("not_probability") ||
    normalized.includes("not_probabilistic") ||
    normalized.includes("screen") ||
    normalized.includes("heuristic") ||
    normalized.includes("legacy") ||
    normalized.includes("unknown") ||
    normalized.includes("unspecified")
  ) return false;
  return normalized.includes("probability") || normalized.includes("probabilistic");
}

function binaryOutcomeOrNull(value: number | string | null): 0 | 1 | null {
  const numeric = Number(value);
  return numeric === 0 || numeric === 1 ? numeric : null;
}

function numericUnitOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}
