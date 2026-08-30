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

type RouteContext = { domain: string; modality: string };

type VerifiedResolution = {
  id: string;
  prediction_id: string;
  external_outcome_id: string;
  resolved_binary_outcome: number | string | null;
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
  retrieved_at: string | null;
  verification_status: string;
  verification_method: string | null;
  verified_at: string | null;
};

type TargetContract = {
  prediction_id: string;
  issued_at: string;
  target_definition: string;
  target_semantics: string;
  target_version: string;
  resolution_rule: string;
  resolution_rule_version: string;
};

const BRIER_SEMANTICS = "mean_squared_probability_error_on_externally_verified_target_resolved_binary_outcomes";
const EVIDENCE_POLICY = "external_verified_target_resolution_v2_sealed_knowledge_time";
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
    validateRequest(body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: prediction, error: predictionError } = await supabase
      .from("aicis_model_predictions")
      .select("id,model_id,routing_decision_id,probability,probability_semantics,task")
      .eq("id", body.prediction_id)
      .single();
    if (predictionError) throw predictionError;

    const candidateBinary = body.binary_outcome === 0 || body.binary_outcome === 1
      ? body.binary_outcome
      : null;
    const probability = numericUnitOrNull(prediction.probability);

    const { data: semanticsEligible, error: semanticsError } = await supabase.rpc(
      "aicis_probability_semantics_evaluation_eligible",
      { p_semantics: prediction.probability_semantics ?? null },
    );
    if (semanticsError) throw semanticsError;
    const probabilityUsable = probability !== null && semanticsEligible === true;

    const { data: resolutionData, error: resolutionError } = await supabase
      .from("aicis_model_outcome_resolutions")
      .select("id,prediction_id,external_outcome_id,resolved_binary_outcome,resolution_status,target_definition,target_semantics,target_version,resolution_rule,resolution_rule_version,resolved_at")
      .eq("prediction_system", "model_cortex")
      .eq("prediction_id", prediction.id)
      .eq("resolution_status", "verified")
      .maybeSingle();
    if (resolutionError) throw resolutionError;
    const resolution = (resolutionData ?? null) as VerifiedResolution | null;

    let externalOutcome: ExternalOutcome | null = null;
    let targetContract: TargetContract | null = null;
    if (resolution) {
      const [externalResult, targetResult] = await Promise.all([
        supabase
          .from("prediction_external_outcomes")
          .select("id,prediction_system,prediction_id,observed_at,retrieved_at,verification_status,verification_method,verified_at")
          .eq("id", resolution.external_outcome_id)
          .maybeSingle(),
        supabase
          .from("aicis_model_prediction_target_contracts")
          .select("prediction_id,issued_at,target_definition,target_semantics,target_version,resolution_rule,resolution_rule_version")
          .eq("prediction_id", prediction.id)
          .eq("prediction_system", "model_cortex")
          .maybeSingle(),
      ]);
      if (externalResult.error) throw externalResult.error;
      if (targetResult.error) throw targetResult.error;
      externalOutcome = (externalResult.data ?? null) as ExternalOutcome | null;
      targetContract = (targetResult.data ?? null) as TargetContract | null;
    }

    const verifiedResolutionUsable = isUsableVerifiedResolution(
      resolution,
      externalOutcome,
      targetContract,
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
    const evidenceEligible = verifiedBinary !== null && resolution !== null && externalOutcome !== null && targetContract !== null;

    const { error: outcomeError } = await supabase.from("aicis_model_outcomes").upsert({
      prediction_id: prediction.id,
      observed_outcome: body.observed_outcome,
      candidate_binary_outcome: candidateBinary,
      binary_outcome: verifiedBinary,
      observed_at: evidenceEligible ? externalOutcome?.observed_at : body.observed_at,
      brier_score: brier,
      brier_score_semantics: brier === null ? null : BRIER_SEMANTICS,
      absolute_error: body.absolute_error ?? null,
      absolute_error_semantics: body.absolute_error !== undefined
        ? body.absolute_error_semantics?.trim()
        : null,
      evidence_claim_id: body.evidence_claim_id ?? null,
      evidence_status: evidenceEligible
        ? "externally_verified_target_resolved_sealed"
        : candidateBinary !== null
          ? "candidate_outcome_not_evaluation_eligible"
          : "outcome_recorded_without_verified_target_resolution",
      resolution_id: evidenceEligible ? resolution?.id : null,
      evaluation_eligibility: evidenceEligible ? EVIDENCE_POLICY : "blocked_missing_verified_target_resolution",
      evaluation_block_reason: evidenceEligible
        ? (probabilityUsable ? null : "prediction_probability_semantics_not_evaluation_eligible")
        : "no_current_sealed_external_verified_target_resolution",
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

    let metrics: Record<string, unknown> | null = null;
    if (route) {
      const { data: metricData, error: metricError } = await supabase.rpc(
        "refresh_aicis_model_cortex_competency_v4",
        {
          p_model_id: prediction.model_id,
          p_domain: route.domain,
          p_modality: route.modality,
          p_task: prediction.task,
        },
      );
      if (metricError) throw metricError;
      metrics = (metricData ?? null) as Record<string, unknown> | null;
    }

    return new Response(JSON.stringify({
      recorded: true,
      candidate_binary_outcome: candidateBinary,
      verified_binary_outcome: verifiedBinary,
      external_target_resolution_usable: verifiedResolutionUsable,
      prediction_probability_usable: probabilityUsable,
      brier_score: brier,
      brier_score_semantics: brier === null ? null : BRIER_SEMANTICS,
      evaluation_evidence_policy: EVIDENCE_POLICY,
      competency_refresh: metrics,
      population_truncated: false,
      generic_competence_updated: false,
      generic_calibration_updated: false,
      generic_reliability_updated: false,
    }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "outcome learning failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});

function validateRequest(body: OutcomeRequest): void {
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
}

function isUsableVerifiedResolution(
  resolution: VerifiedResolution | null,
  externalOutcome: ExternalOutcome | null,
  targetContract: TargetContract | null,
  predictionId: string,
): boolean {
  if (!resolution || !externalOutcome || !targetContract) return false;
  if (binaryOutcomeOrNull(resolution.resolved_binary_outcome) === null) return false;
  if (resolution.resolution_status !== "verified") return false;
  if (resolution.prediction_id !== predictionId || targetContract.prediction_id !== predictionId) return false;
  if (externalOutcome.prediction_system !== "model_cortex" || externalOutcome.prediction_id !== predictionId) return false;
  if (externalOutcome.verification_status !== "verified") return false;
  if (!externalOutcome.verified_at || !externalOutcome.retrieved_at || !externalOutcome.verification_method?.trim()) return false;
  if (!resolution.resolved_at) return false;
  if (
    resolution.target_definition !== targetContract.target_definition ||
    resolution.target_semantics !== targetContract.target_semantics ||
    resolution.target_version !== targetContract.target_version ||
    resolution.resolution_rule !== targetContract.resolution_rule ||
    resolution.resolution_rule_version !== targetContract.resolution_rule_version
  ) return false;

  const issuedAt = Date.parse(targetContract.issued_at);
  const observedAt = Date.parse(externalOutcome.observed_at);
  const retrievedAt = Date.parse(externalOutcome.retrieved_at);
  const verifiedAt = Date.parse(externalOutcome.verified_at);
  const resolvedAt = Date.parse(resolution.resolved_at);
  if ([issuedAt, observedAt, retrievedAt, verifiedAt, resolvedAt].some(Number.isNaN)) return false;
  return observedAt >= issuedAt && retrievedAt >= observedAt && verifiedAt >= retrievedAt && resolvedAt >= retrievedAt;
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
