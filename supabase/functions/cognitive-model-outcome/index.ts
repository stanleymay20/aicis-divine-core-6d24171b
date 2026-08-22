import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { ...cors, "content-type": "application/json" } });

  try {
    const body = await req.json();
    if (!body.prediction_id || !body.observed_outcome || !body.observed_at) throw new Error("prediction_id, observed_outcome and observed_at are required");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prediction, error: predictionError } = await supabase.from("aicis_model_predictions").select("id,model_id,probability,task,metadata").eq("id", body.prediction_id).single();
    if (predictionError) throw predictionError;

    const binary = body.binary_outcome === 0 || body.binary_outcome === 1 ? body.binary_outcome : null;
    const probability = prediction.probability === null ? null : Number(prediction.probability);
    const brier = binary === null || probability === null ? null : (clamp01(probability) - binary) ** 2;
    const { error: outcomeError } = await supabase.from("aicis_model_outcomes").upsert({
      prediction_id: prediction.id,
      observed_outcome: body.observed_outcome,
      binary_outcome: binary,
      observed_at: body.observed_at,
      brier_score: brier,
      absolute_error: body.absolute_error ?? null,
      evidence_claim_id: body.evidence_claim_id ?? null,
    }, { onConflict: "prediction_id" });
    if (outcomeError) throw outcomeError;

    // Recompute empirical probabilistic quality for this model/task when binary outcomes exist.
    const { data: resolved } = await supabase.from("aicis_model_predictions").select("probability,aicis_model_outcomes!inner(binary_outcome)").eq("model_id", prediction.model_id).eq("task", prediction.task).not("probability", "is", null).limit(5000);
    const pairs = (resolved ?? []).filter((r: any) => r.aicis_model_outcomes?.binary_outcome === 0 || r.aicis_model_outcomes?.binary_outcome === 1);
    const meanBrier = pairs.length ? pairs.reduce((sum: number, r: any) => sum + (Number(r.probability) - Number(r.aicis_model_outcomes.binary_outcome)) ** 2, 0) / pairs.length : null;
    const competence = meanBrier === null ? null : clamp01(1 - meanBrier);

    return new Response(JSON.stringify({ recorded: true, brier_score: brier, resolved_sample_size: pairs.length, empirical_competence: competence }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "outcome learning failed" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }
});
