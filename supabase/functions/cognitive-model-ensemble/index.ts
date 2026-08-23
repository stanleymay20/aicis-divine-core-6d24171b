import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ModelOutputInput {
  model_id: string;
  prediction_kind: "probability" | "numeric" | "label" | "structured";
  output: Record<string, unknown>;
  probability?: number;
  confidence: number;
  latency_ms: number;
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
}

interface CompetencyRow {
  model_id: string;
  competence: number;
  calibration: number;
  reliability: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

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
      .select("id,selected_model_ids,high_consequence")
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
        metadata: { missing_model_ids: missing },
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
        confidence: clamp01(output.confidence),
        latency_ms: Math.max(0, output.latency_ms),
        warning_count: output.warnings?.length ?? 0,
        evidence_claim_ids: output.evidence_claim_ids ?? [],
      })),
    );
    if (outputError) throw outputError;

    const modelIds = body.outputs.map((output) => output.model_id);
    const { data: competencyData, error: competencyError } = await supabase
      .from("aicis_model_competency")
      .select("model_id,competence,calibration,reliability")
      .in("model_id", modelIds)
      .eq("task", body.task);
    if (competencyError) throw competencyError;

    const competency = new Map(
      ((competencyData ?? []) as CompetencyRow[]).map((row) => [row.model_id, row]),
    );

    const probabilistic = body.outputs.filter(
      (output) => output.probability !== undefined && Number.isFinite(output.probability),
    );

    let probability: number | null = null;
    let disagreement = 0;
    let spread = 0;
    let confidence = 0;

    if (probabilistic.length > 0) {
      const weighted = probabilistic.map((output) => {
        const quality = competency.get(output.model_id);
        const qualityWeight = quality
          ? clamp01(
              0.4 * Number(quality.competence) +
                0.3 * Number(quality.calibration) +
                0.3 * Number(quality.reliability),
            )
          : 0.25;
        const warningPenalty = clamp01(1 - Math.min(0.5, (output.warnings?.length ?? 0) * 0.08));
        return {
          probability: clamp01(output.probability ?? 0.5),
          confidence: clamp01(output.confidence),
          weight: Math.max(0.01, qualityWeight * warningPenalty),
        };
      });

      const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
      probability = weighted.reduce((sum, item) => sum + item.probability * item.weight, 0) / totalWeight;
      const variance = weighted.reduce(
        (sum, item) => sum + item.weight * (item.probability - (probability ?? 0.5)) ** 2,
        0,
      ) / totalWeight;
      disagreement = clamp01(Math.sqrt(variance) * 2);
      spread = clamp01(
        Math.max(...weighted.map((item) => item.probability)) -
          Math.min(...weighted.map((item) => item.probability)),
      );
      const memberConfidence = weighted.reduce(
        (sum, item) => sum + item.confidence * item.weight,
        0,
      ) / totalWeight;
      confidence = clamp01(memberConfidence * (1 - disagreement));
    }

    const highDisagreement = disagreement >= 0.18 || spread >= 0.36;
    const epistemicStatus = highDisagreement ? "unverified" : "predicted";

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
        confidence,
        disagreement,
        spread,
        member_count: body.outputs.length,
        high_disagreement: highDisagreement,
        epistemic_status: epistemicStatus,
        valid_until: body.valid_until ?? null,
        metadata: { missing_model_ids: missing },
      })
      .select("id")
      .single();
    if (ensembleError) throw ensembleError;

    if (highDisagreement && body.cognitive_event_id) {
      await supabase.from("aicis_cognitive_events").insert({
        event_type: "model.disagreement",
        epistemic_status: "derived",
        confidence: clamp01(1 - disagreement),
        severity: clamp01(Math.max(disagreement, spread)),
        source_system: "cognitive-model-ensemble",
        correlation_id: body.cognitive_event_id,
        payload: {
          ensemble_prediction_id: ensemble.id,
          routing_decision_id: route.id,
          disagreement,
          spread,
          member_count: body.outputs.length,
        },
      });
    }

    return new Response(
      JSON.stringify({
        execution_run_id: run.id,
        ensemble_prediction_id: ensemble.id,
        status,
        probability,
        confidence,
        disagreement,
        spread,
        high_disagreement: highDisagreement,
        epistemic_status: epistemicStatus,
        missing_model_ids: missing,
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
