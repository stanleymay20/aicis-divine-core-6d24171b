import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-hypothesis-evidence";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  if (!body.claim_id && !body.cognitive_event_id) return json({ error: "claim_id or cognitive_event_id is required" }, 400);
  if (body.claim_id && body.cognitive_event_id) return json({ error: "Attach one evidence object at a time" }, 400);

  const stance = body.stance ?? "context";
  if (!["supports", "contradicts", "context", "discriminates"].includes(stance)) {
    return json({ error: "Invalid stance" }, 400);
  }

  const pTrue = clampLikelihood(body.likelihood_given_hypothesis ?? defaultLikelihood(stance, true));
  const pFalse = clampLikelihood(body.likelihood_given_alternative ?? defaultLikelihood(stance, false));
  const reliability = clamp01(body.reliability ?? 0.5);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const [{ data: hypothesis }, sourceResult] = await Promise.all([
    supabase.from("aicis_hypotheses").select("id,status").eq("id", body.hypothesis_id).maybeSingle(),
    body.claim_id
      ? supabase.from("aicis_evidence_claims").select("id,epistemic_status,confidence").eq("id", body.claim_id).maybeSingle()
      : supabase.from("aicis_cognitive_events").select("id,epistemic_status,confidence").eq("id", body.cognitive_event_id).maybeSingle(),
  ]);

  if (!hypothesis) return json({ error: "Hypothesis not found" }, 404);
  if (!sourceResult.data) return json({ error: "Evidence source not found" }, 404);

  const source = sourceResult.data as { epistemic_status: string; confidence: number };
  const statusCap = epistemicReliabilityCap(source.epistemic_status);
  const effectiveReliability = Math.min(reliability, clamp01(Number(source.confidence)), statusCap);

  const { data: evidence, error } = await supabase
    .from("aicis_hypothesis_evidence")
    .insert({
      hypothesis_id: body.hypothesis_id,
      claim_id: body.claim_id ?? null,
      cognitive_event_id: body.cognitive_event_id ?? null,
      stance,
      reliability: effectiveReliability,
      likelihood_given_hypothesis: pTrue,
      likelihood_given_alternative: pFalse,
      description: body.description ?? null,
      direct_observation: Boolean(body.direct_observation && source.epistemic_status === "observed"),
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
      effective_reliability: effectiveReliability,
      auth_via: via,
    },
  });

  return json({
    success: true,
    evidence_id: evidence.id,
    hypothesis_id: body.hypothesis_id,
    stance,
    effective_reliability: effectiveReliability,
    likelihood_given_hypothesis: pTrue,
    likelihood_given_alternative: pFalse,
  });
});

function defaultLikelihood(stance: string, hypothesis: boolean) {
  if (stance === "supports") return hypothesis ? 0.75 : 0.35;
  if (stance === "contradicts") return hypothesis ? 0.25 : 0.75;
  if (stance === "discriminates") return hypothesis ? 0.7 : 0.3;
  return 0.5;
}
function epistemicReliabilityCap(status: string) {
  switch (status) {
    case "observed": return 1;
    case "derived": return 0.9;
    case "inferred": return 0.7;
    case "predicted": return 0.45;
    case "simulated": return 0.35;
    case "hypothesized": return 0.3;
    case "unverified": return 0.2;
    case "contradicted": return 0.1;
    default: return 0.2;
  }
}
function clampLikelihood(value: number) {
  return Math.min(0.99, Math.max(0.01, Number.isFinite(value) ? value : 0.5));
}
function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
