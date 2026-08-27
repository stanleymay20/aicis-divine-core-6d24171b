import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-model-ensemble";
const WEIGHT_SEMANTICS =
  "deterministic_weight_from_measured_competence_calibration_reliability_v2_not_probability";
const ENSEMBLE_PROBABILITY_SEMANTICS =
  "weighted_pool_of_explicit_member_probabilities_ensemble_not_calibrated";
const ENSEMBLE_CONFIDENCE_SEMANTICS =
  "not_issued_member_self_reported_confidence_not_aggregated";
const DISAGREEMENT_SEMANTICS =
  "weighted_standard_deviation_and_range_of_usable_member_probabilities_not_confidence";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface ModelOutputInput {
  model_id: string;
  prediction_kind: "probability" | "numeric" | "label" | "structured";
  output: Record<string, unknown>;
  probability?: number | null;
  probability_semantics?: string;
  calibration_status?: string;
  confidence?: number | null;
  confidence_semantics?: string;
  latency_ms?: number | null;
  latency_semantics?: string;
  evidence_status?: string;
  evidence_claim_ids?: string[];
  warnings?: string[];
}

interface EnsembleRequest {
  routing_decision_id: string;
  input_hash: string;
  task: string;
  horizon?: string;
  cognitive_event_id?: string;
  subject_entity_id?: string;
  valid_until?: string;
  outputs: ModelOutputInput[];
}

interface RoutingDecision {
  id: string;
  selected_model_ids: string[];
  high_consequence: boolean;
  evidence_status: string | null;
}

interface CompetencyRow {
  model_id: string;
  sample_size: number;
  competence: number | string | null;
  competence_semantics: string | null;
  calibration: number | string | null;
  calibration_semantics: string | null;
  reliability: number | string | null;
  reliability_semantics: string | null;
  evaluation_status: string | null;
}

interface WeightedMember {
  output: ModelOutputInput;
  probability: number;
  weight: number;
}

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
    const body = (await req.json()) as EnsembleRequest;
    if (!body.routing_decision_id || !body.input_hash || !body.task || !Array.isArray(body.outputs)) {
      throw new Error("routing_decision_id, input_hash, task and outputs are required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: routeData, error: routeError } = await supabase
      .from("aicis_model_routing_decisions")
      .select("id,selected_model_ids,high_consequence,evidence_status")
      .eq("id", body.routing_decision_id)
      .single();
    if (routeError) throw routeError;

    const route = routeData as RoutingDecision;
    const expected = new Set(route.selected_model_ids ?? []);
    const received = new Set(body.outputs.map((output) => output.model_id));
    const unauthorized = [...received].filter((modelId) => !expected.has(modelId));
    const missing = [...expected].filter((modelId) => !received.has(modelId));

    if (unauthorized.length > 0) {
      throw new Error(`outputs include model(s) not selected by router: ${unauthorized.join(", ")}`);
    }
    if (route.high_consequence && missing.length > 0) {
      throw new Error(`high-consequence ensemble is incomplete; missing: ${missing.join(", ")}`);
    }
    if (expected.size === 0) {
      throw new Error("routing decision contains no selected models; ensemble execution is withheld");
    }

    for (const output of body.outputs) validateOutput(output);

    const status = missing.length > 0 ? "partial" : "complete";
    const { data: run, error: runError } = await supabase
      .from("aicis_model_execution_runs")
      .insert({
        routing_decision_id: route.id,
        cognitive_event_id: body.cognitive_event_id ?? null,
        input_hash: body.input_hash,
        status,
        high_consequence: route.high_consequence,
        completed_at: new Date().toISOString(),
        metadata: {
          missing_model_ids: missing,
          route_evidence_status: route.evidence_status,
        },
      })
      .select("id")
      .single();
    if (runError) throw runError;

    const { error: outputError } = await supabase.from("aicis_model_execution_outputs").insert(
      body.outputs.map((output) => ({
        execution_run_id: run.id,
        model_id: output.model_id,
        prediction_kind: output.prediction_kind,
        output: output.output,
        probability: output.probability ?? null,
        probability_semantics: output.probability_semantics ?? null,
        confidence: output.confidence ?? null,
        confidence_semantics: output.confidence_semantics ?? null,
        latency_ms: output.latency_ms ?? null,
        latency_semantics: output.latency_semantics ?? null,
        evidence_status: output.evidence_status ?? "producer_evidence_status_unspecified",
        warning_count: output.warnings?.length ?? 0,
        evidence_claim_ids: output.evidence_claim_ids ?? [],
      })),
    );
    if (outputError) throw outputError;

    const numericProbabilityOutputs = body.outputs.filter((output) => isUnitInterval(output.probability));
    if (numericProbabilityOutputs.length > 0) {
      const { error: predictionError } = await supabase.from("aicis_model_predictions").insert(
        numericProbabilityOutputs.map((output) => ({
          routing_decision_id: route.id,
          model_id: output.model_id,
          cognitive_event_id: body.cognitive_event_id ?? null,
          subject_entity_id: body.subject_entity_id ?? null,
          task: body.task,
          horizon: body.horizon ?? null,
          prediction: output.output,
          probability: output.probability,
          probability_semantics: output.probability_semantics ?? "producer_probability_semantics_unspecified",
          confidence: output.confidence ?? null,
          confidence_semantics: output.confidence_semantics ?? "producer_confidence_semantics_unspecified",
          calibration_status: output.calibration_status ?? "producer_calibration_status_unspecified",
          evidence_status: output.evidence_status ?? "producer_evidence_status_unspecified",
          valid_until: body.valid_until ?? null,
          input_hash: body.input_hash,
          metadata: {
            execution_run_id: run.id,
            prediction_kind: output.prediction_kind,
            warning_count: output.warnings?.length ?? 0,
          },
        })),
      );
      if (predictionError) throw predictionError;
    }

    const modelIds = body.outputs.map((output) => output.model_id);
    const { data: competencyData, error: competencyError } = await supabase
      .from("aicis_model_competency")
      .select("model_id,sample_size,competence,competence_semantics,calibration,calibration_semantics,reliability,reliability_semantics,evaluation_status")
      .in("model_id", modelIds)
      .eq("task", body.task);
    if (competencyError) throw competencyError;

    const competency = new Map(
      ((competencyData ?? []) as CompetencyRow[]).map((row) => [row.model_id, row]),
    );

    const weighted: WeightedMember[] = [];
    const withheldMembers: Array<{ model_id: string; reason: string }> = [];
    for (const output of body.outputs) {
      if (!isUnitInterval(output.probability) || !isProbabilitySemantics(output.probability_semantics)) {
        withheldMembers.push({
          model_id: output.model_id,
          reason: "probability missing or semantics do not establish a probability",
        });
        continue;
      }
      const quality = competency.get(output.model_id);
      if (!quality || !hasCompleteMeasuredCompetency(quality)) {
        withheldMembers.push({
          model_id: output.model_id,
          reason: "complete measured competency/calibration/reliability evidence unavailable",
        });
        continue;
      }
      const competence = numericUnitOrNull(quality.competence) as number;
      const calibration = numericUnitOrNull(quality.calibration) as number;
      const reliability = numericUnitOrNull(quality.reliability) as number;
      const weight = clamp01(
        0.40 * competence +
        0.30 * calibration +
        0.30 * reliability,
      );
      if (weight <= 0) {
        withheldMembers.push({ model_id: output.model_id, reason: "measured quality weight is zero" });
        continue;
      }
      weighted.push({ output, probability: output.probability, weight });
    }

    let probability: number | null = null;
    let disagreement: number | null = null;
    let spread: number | null = null;
    let highDisagreement: boolean | null = null;
    let aggregationStatus = "abstained_no_usable_probabilistic_members";

    if (weighted.length > 0) {
      const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
      probability = weighted.reduce((sum, item) => sum + item.probability * item.weight, 0) / totalWeight;
      aggregationStatus = "issued_weighted_probability_pool";

      if (weighted.length >= 2) {
        const variance = weighted.reduce(
          (sum, item) => sum + item.weight * (item.probability - (probability as number)) ** 2,
          0,
        ) / totalWeight;
        disagreement = clamp01(Math.sqrt(Math.max(0, variance)) * 2);
        spread = clamp01(
          Math.max(...weighted.map((item) => item.probability)) -
          Math.min(...weighted.map((item) => item.probability)),
        );
        highDisagreement = disagreement >= 0.18 || spread >= 0.36;
      }
    }

    const epistemicStatus = probability === null || highDisagreement === true ? "unverified" : "predicted";
    const evidenceStatus = probability === null
      ? "insufficient_measured_ensemble_evidence"
      : withheldMembers.length > 0
        ? "partial_member_coverage"
        : "complete_usable_member_coverage";

    const { data: ensemble, error: ensembleError } = await supabase
      .from("aicis_ensemble_predictions")
      .insert({
        execution_run_id: run.id,
        routing_decision_id: route.id,
        cognitive_event_id: body.cognitive_event_id ?? null,
        subject_entity_id: body.subject_entity_id ?? null,
        task: body.task,
        horizon: body.horizon ?? null,
        probability,
        probability_semantics: probability === null
          ? "not_issued_no_usable_probabilistic_members"
          : ENSEMBLE_PROBABILITY_SEMANTICS,
        confidence: null,
        confidence_semantics: ENSEMBLE_CONFIDENCE_SEMANTICS,
        disagreement,
        spread,
        disagreement_semantics: DISAGREEMENT_SEMANTICS,
        member_count: weighted.length,
        high_disagreement: highDisagreement,
        epistemic_status: epistemicStatus,
        aggregation_status: aggregationStatus,
        weight_semantics: WEIGHT_SEMANTICS,
        calibration_status: probability === null ? "not_applicable_no_output" : "ensemble_not_calibrated",
        evidence_status: evidenceStatus,
        valid_until: body.valid_until ?? null,
        metadata: {
          missing_model_ids: missing,
          submitted_member_count: body.outputs.length,
          usable_member_count: weighted.length,
          withheld_members: withheldMembers,
          confidence_aggregation_performed: false,
        },
      })
      .select("id")
      .single();
    if (ensembleError) throw ensembleError;

    if (highDisagreement === true && body.cognitive_event_id) {
      const now = new Date().toISOString();
      await supabase.from("aicis_cognitive_events").insert({
        event_type: "model.degraded",
        epistemic_status: "derived",
        confidence: null,
        confidence_semantics: "not_issued_disagreement_statistic_is_not_epistemic_confidence",
        correlation_id: body.cognitive_event_id,
        occurred_at: now,
        observed_at: now,
        time_semantics: "ensemble_disagreement_detection_time",
        producer: FN,
        payload: {
          degradation_type: "ensemble_member_disagreement",
          ensemble_prediction_id: ensemble.id,
          routing_decision_id: route.id,
          disagreement,
          spread,
          disagreement_semantics: DISAGREEMENT_SEMANTICS,
          usable_member_count: weighted.length,
        },
        provenance: [],
      });
    }

    return new Response(
      JSON.stringify({
        execution_run_id: run.id,
        ensemble_prediction_id: ensemble.id,
        status,
        aggregation_status: aggregationStatus,
        tracked_model_predictions: numericProbabilityOutputs.length,
        submitted_member_count: body.outputs.length,
        usable_member_count: weighted.length,
        probability,
        probability_semantics: probability === null
          ? "not_issued_no_usable_probabilistic_members"
          : ENSEMBLE_PROBABILITY_SEMANTICS,
        calibration_status: probability === null ? "not_applicable_no_output" : "ensemble_not_calibrated",
        confidence: null,
        confidence_semantics: ENSEMBLE_CONFIDENCE_SEMANTICS,
        disagreement,
        spread,
        disagreement_semantics: DISAGREEMENT_SEMANTICS,
        high_disagreement: highDisagreement,
        epistemic_status: epistemicStatus,
        evidence_status: evidenceStatus,
        missing_model_ids: missing,
        withheld_members: withheldMembers,
      }),
      { headers: { ...cors, "content-type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "ensemble execution failed" }),
      { status: 400, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});

function validateOutput(output: ModelOutputInput): void {
  if (!output.model_id || !output.prediction_kind || !output.output || typeof output.output !== "object") {
    throw new Error("each output requires model_id, prediction_kind and output");
  }
  if (output.probability !== undefined && output.probability !== null && !isUnitInterval(output.probability)) {
    throw new Error(`model ${output.model_id} probability must be between 0 and 1 when supplied`);
  }
  if (output.confidence !== undefined && output.confidence !== null && !isUnitInterval(output.confidence)) {
    throw new Error(`model ${output.model_id} confidence must be between 0 and 1 when supplied`);
  }
  if (output.latency_ms !== undefined && output.latency_ms !== null && !isFiniteNonNegative(output.latency_ms)) {
    throw new Error(`model ${output.model_id} latency_ms must be finite and non-negative when supplied`);
  }
}

function hasCompleteMeasuredCompetency(row: CompetencyRow): boolean {
  return Number.isInteger(row.sample_size) && row.sample_size > 0 &&
    numericUnitOrNull(row.competence) !== null && hasUsableSemantics(row.competence_semantics) &&
    numericUnitOrNull(row.calibration) !== null && hasUsableSemantics(row.calibration_semantics) &&
    numericUnitOrNull(row.reliability) !== null && hasUsableSemantics(row.reliability_semantics) &&
    hasUsableEvaluationStatus(row.evaluation_status);
}

function isProbabilitySemantics(semantics: string | undefined): boolean {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  if (
    normalized.includes("not_probability") ||
    normalized.includes("not_probabilistic") ||
    normalized.includes("screen") ||
    normalized.includes("heuristic") ||
    normalized.includes("uncalibrated") ||
    normalized.includes("legacy") ||
    normalized.includes("unknown") ||
    normalized.includes("unspecified")
  ) return false;
  return normalized.includes("probability") || normalized.includes("probabilistic");
}

function hasUsableSemantics(semantics: string | null): boolean {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  return !normalized.includes("legacy") &&
    !normalized.includes("unknown") &&
    !normalized.includes("unverified") &&
    !normalized.includes("unspecified") &&
    !normalized.includes("not_quantified");
}

function hasUsableEvaluationStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return !normalized.includes("legacy") &&
    !normalized.includes("unknown") &&
    !normalized.includes("unverified") &&
    !normalized.includes("pending");
}

function numericUnitOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
