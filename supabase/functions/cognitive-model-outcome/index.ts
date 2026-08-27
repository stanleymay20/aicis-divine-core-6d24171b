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

type ResolvedPrediction = {
  probability: number | string;
  probability_semantics: string | null;
  aicis_model_outcomes: { binary_outcome: 0 | 1 } | null;
};

type RouteContext = {
  domain: string;
  modality: string;
};

const BRIER_SEMANTICS = "mean_squared_probability_error_on_realized_binary_outcomes";
const ECE_SEMANTICS = "ten_equal_width_bin_expected_calibration_error_on_realized_binary_outcomes";
const EVALUATION_METHOD = "realized_binary_probability_metrics_v2";
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

    const binary = body.binary_outcome === 0 || body.binary_outcome === 1
      ? body.binary_outcome
      : null;
    const probability = numericUnitOrNull(prediction.probability);
    const probabilityUsable = probability !== null && isProbabilitySemantics(prediction.probability_semantics);
    const brier = binary === null || !probabilityUsable
      ? null
      : (probability - binary) ** 2;

    const { error: outcomeError } = await supabase.from("aicis_model_outcomes").upsert({
      prediction_id: prediction.id,
      observed_outcome: body.observed_outcome,
      binary_outcome: binary,
      observed_at: body.observed_at,
      brier_score: brier,
      brier_score_semantics: brier === null ? null : BRIER_SEMANTICS,
      absolute_error: body.absolute_error ?? null,
      absolute_error_semantics: body.absolute_error !== undefined
        ? body.absolute_error_semantics?.trim()
        : null,
      evidence_claim_id: body.evidence_claim_id ?? null,
      evidence_status: body.evidence_claim_id
        ? "outcome_linked_to_evidence_claim"
        : "outcome_evidence_claim_not_supplied",
    }, { onConflict: "prediction_id" });
    if (outcomeError) throw outcomeError;

    const { data: resolved } = await supabase
      .from("aicis_model_predictions")
      .select("probability,probability_semantics,aicis_model_outcomes!inner(binary_outcome)")
      .eq("model_id", prediction.model_id)
      .eq("task", prediction.task)
      .not("probability", "is", null)
      .limit(5000);

    const resolvedRows = (resolved ?? []) as unknown as ResolvedPrediction[];
    const pairs = resolvedRows
      .filter((row) => row.aicis_model_outcomes?.binary_outcome === 0 || row.aicis_model_outcomes?.binary_outcome === 1)
      .map((row) => ({
        probability: numericUnitOrNull(row.probability),
        semantics: row.probability_semantics,
        outcome: row.aicis_model_outcomes?.binary_outcome ?? null,
      }))
      .filter((row): row is { probability: number; semantics: string | null; outcome: 0 | 1 } =>
        row.probability !== null && row.outcome !== null && isProbabilitySemantics(row.semantics)
      );

    const meanBrier = pairs.length > 0
      ? pairs.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0) / pairs.length
      : null;
    const ece = pairs.length >= 30 ? expectedCalibrationError(pairs, 10) : null;
    const evaluationStatus = pairs.length === 0
      ? "no_usable_realized_probability_pairs"
      : ece === null
        ? "partial_probabilistic_outcome_evaluation"
        : "probabilistic_outcomes_evaluated_v2";

    let competencyUpdated = false;
    if (pairs.length > 0 && prediction.routing_decision_id) {
      const { data: routeData } = await supabase
        .from("aicis_model_routing_decisions")
        .select("domain,modality")
        .eq("id", prediction.routing_decision_id)
        .maybeSingle();

      if (routeData) {
        const route = routeData as RouteContext;
        const { error: competencyUpdateError } = await supabase
          .from("aicis_model_competency")
          .update({
            sample_size: pairs.length,
            brier_score: meanBrier,
            brier_score_semantics: meanBrier === null ? null : BRIER_SEMANTICS,
            ece,
            ece_semantics: ece === null ? null : ECE_SEMANTICS,
            evaluation_status: evaluationStatus,
            evaluation_method: EVALUATION_METHOD,
            evaluated_at: new Date().toISOString(),
          })
          .eq("model_id", prediction.model_id)
          .eq("domain", route.domain)
          .eq("modality", route.modality)
          .eq("task", prediction.task);
        if (competencyUpdateError) throw competencyUpdateError;
        competencyUpdated = true;
      }
    }

    return new Response(
      JSON.stringify({
        recorded: true,
        prediction_probability_usable: probabilityUsable,
        brier_score: brier,
        brier_score_semantics: brier === null ? null : BRIER_SEMANTICS,
        resolved_probability_sample_size: pairs.length,
        mean_brier_score: meanBrier,
        ece,
        ece_semantics: ece === null ? null : ECE_SEMANTICS,
        evaluation_status: evaluationStatus,
        evaluation_method: EVALUATION_METHOD,
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

function numericUnitOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}
