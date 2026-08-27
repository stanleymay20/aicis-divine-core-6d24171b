import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-hypothesis-evidence";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const QUALITATIVE_SEMANTICS = "qualitative_only_unquantified";
const SUBJECTIVE_QUANTITATIVE_SEMANTICS = "operator_supplied_subjective_likelihood_ratio_and_reliability";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  let body: {
    hypothesis_id?: string;
    claim_id?: string;
    cognitive_event_id?: string;
    stance?: "supports" | "contradicts" | "context" | "discriminates";
    reliability?: number;
    likelihood_given_hypothesis?: number;
    likelihood_given_alternative?: number;
    direct_observation?: boolean;
    description?: string;
  } = {};
  try { body = await req.json(); } catch { /* validation below */ }

  if (!body.hypothesis_id) return json({ error: "hypothesis_id is required" }, 400);
  if (!body.claim_id && !body.cognitive_event_id) {
    return json({ error: "claim_id or cognitive_event_id is required" }, 400);
  }
  if (body.claim_id && body.cognitive_event_id) {
    return json({ error: "Attach one evidence object at a time" }, 400);
  }

  const stance = body.stance ?? "context";
  if (!["supports", "contradicts", "context", "discriminates"].includes(stance)) {
    return json({ error: "Invalid stance" }, 400);
  }

  const quantitativeFields = [
    body.reliability,
    body.likelihood_given_hypothesis,
    body.likelihood_given_alternative,
  ];
  const suppliedQuantitativeCount = quantitativeFields.filter((value) => value !== undefined).length;
  if (suppliedQuantitativeCount !== 0 && suppliedQuantitativeCount !== quantitativeFields.length) {
    return json({
      error: "Quantitative evidence requires reliability, likelihood_given_hypothesis, and likelihood_given_alternative together",
      semantics: "missing quantitative assumptions are not filled with defaults",
    }, 400);
  }

  const hasQuantitativeAssumptions = suppliedQuantitativeCount === quantitativeFields.length;
  if (hasQuantitativeAssumptions) {
    if (!isUnitInterval(body.reliability)) {
      return json({ error: "reliability must be a finite number between 0 and 1" }, 400);
    }
    if (!isOpenProbability(body.likelihood_given_hypothesis) || !isOpenProbability(body.likelihood_given_alternative)) {
      return json({ error: "Likelihood assumptions must be finite numbers strictly between 0 and 1" }, 400);
    }
  }

  const reliability = hasQuantitativeAssumptions ? Number(body.reliability) : null;
  const pTrue = hasQuantitativeAssumptions ? Number(body.likelihood_given_hypothesis) : null;
  const pFalse = hasQuantitativeAssumptions ? Number(body.likelihood_given_alternative) : null;
  const quantitativeSemantics = hasQuantitativeAssumptions
    ? SUBJECTIVE_QUANTITATIVE_SEMANTICS
    : QUALITATIVE_SEMANTICS;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const [{ data: hypothesis }, sourceResult] = await Promise.all([
    supabase.from("aicis_hypotheses").select("id,status").eq("id", body.hypothesis_id).maybeSingle(),
    body.claim_id
      ? supabase
        .from("aicis_evidence_claims")
        .select("id,epistemic_status,confidence,confidence_semantics")
        .eq("id", body.claim_id)
        .maybeSingle()
      : supabase
        .from("aicis_cognitive_events")
        .select("id,epistemic_status,confidence,confidence_semantics")
        .eq("id", body.cognitive_event_id)
        .maybeSingle(),
  ]);

  if (!hypothesis) return json({ error: "Hypothesis not found" }, 404);
  if (!sourceResult.data) return json({ error: "Evidence source not found" }, 404);

  const source = sourceResult.data as {
    epistemic_status: string;
    confidence: number | null;
    confidence_semantics: string | null;
  };
  const directObservation = Boolean(body.direct_observation && source.epistemic_status === "observed");

  const { data: evidence, error } = await supabase
    .from("aicis_hypothesis_evidence")
    .insert({
      hypothesis_id: body.hypothesis_id,
      claim_id: body.claim_id ?? null,
      cognitive_event_id: body.cognitive_event_id ?? null,
      stance,
      reliability,
      likelihood_given_hypothesis: pTrue,
      likelihood_given_alternative: pFalse,
      quantitative_semantics: quantitativeSemantics,
      description: body.description ?? null,
      direct_observation: directObservation,
    })
    .select("id")
    .single();
  if (error || !evidence) return json({ error: "Failed to attach hypothesis evidence" }, 500);

  await supabase.from("system_logs").insert({
    action: "cognitive_hypothesis_evidence",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Attached ${stance} evidence to hypothesis`,
    metadata: {
      hypothesis_id: body.hypothesis_id,
      evidence_id: evidence.id,
      source_epistemic_status: source.epistemic_status,
      source_confidence: source.confidence,
      source_confidence_semantics: source.confidence_semantics,
      quantitative_semantics: quantitativeSemantics,
      quantitative_assumptions_supplied: hasQuantitativeAssumptions,
      direct_observation: directObservation,
      auth_via: via,
    },
  });

  return json({
    success: true,
    evidence_id: evidence.id,
    hypothesis_id: body.hypothesis_id,
    stance,
    reliability,
    likelihood_given_hypothesis: pTrue,
    likelihood_given_alternative: pFalse,
    quantitative_semantics: quantitativeSemantics,
    source_epistemic_status: source.epistemic_status,
    source_confidence: source.confidence,
    source_confidence_semantics: source.confidence_semantics,
    direct_observation: directObservation,
  });
});

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isOpenProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
