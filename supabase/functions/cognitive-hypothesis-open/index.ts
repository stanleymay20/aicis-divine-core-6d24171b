import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-hypothesis-open";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUBJECTIVE_PRIOR_SEMANTICS = "operator_supplied_subjective_prior";
const UNKNOWN_PRIOR_SEMANTICS = "unknown_not_quantified";

type Candidate = { statement: string; prior?: number; assumptions?: string[] };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  let body: {
    question?: string;
    subject_entity_id?: string;
    candidates?: Candidate[];
    metadata?: Record<string, unknown>;
  } = {};
  try { body = await req.json(); } catch { /* validation below */ }

  const question = body.question?.trim();
  const candidates = (body.candidates ?? []).filter((item) => item.statement?.trim());
  if (!question) return json({ error: "question is required" }, 400);
  if (candidates.length < 2 || candidates.length > 12) {
    return json({ error: "Provide between 2 and 12 competing hypotheses" }, 400);
  }

  const priorsProvided = candidates.map((candidate) => candidate.prior !== undefined);
  const suppliedPriorCount = priorsProvided.filter(Boolean).length;
  if (suppliedPriorCount !== 0 && suppliedPriorCount !== candidates.length) {
    return json({
      error: "Provide an explicit prior for every candidate or omit priors for every candidate",
      semantics: "partial_prior_coverage_is_not_normalized_or_filled",
    }, 400);
  }

  const hasQuantifiedPriors = suppliedPriorCount === candidates.length;
  if (hasQuantifiedPriors) {
    for (const candidate of candidates) {
      if (!isProbability(candidate.prior)) {
        return json({ error: "Each supplied prior must be a finite number strictly between 0 and 1" }, 400);
      }
    }
    const totalPrior = candidates.reduce((sum, candidate) => sum + Number(candidate.prior), 0);
    if (Math.abs(totalPrior - 1) > 1e-6) {
      return json({
        error: "Supplied competing-hypothesis priors must sum to 1",
        supplied_prior_sum: totalPrior,
      }, 400);
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const now = new Date().toISOString();
  const competitionSemantics = hasQuantifiedPriors
    ? "subjective_competing_hypotheses_with_explicit_normalized_priors"
    : "qualitative_competing_hypotheses_without_numeric_priors";

  const { data: setRow, error: setError } = await supabase
    .from("aicis_hypothesis_sets")
    .insert({
      question,
      subject_entity_id: body.subject_entity_id ?? null,
      entropy: null,
      margin: null,
      unresolved: true,
      competition_semantics: competitionSemantics,
      metadata: {
        ...(body.metadata ?? {}),
        opened_by: user?.id ?? "cron",
        opened_via: via,
        quantitative_prior_count: suppliedPriorCount,
        probability_semantics: hasQuantifiedPriors ? SUBJECTIVE_PRIOR_SEMANTICS : UNKNOWN_PRIOR_SEMANTICS,
      },
    })
    .select("id")
    .single();
  if (setError || !setRow) return json({ error: "Failed to create hypothesis set" }, 500);

  const created: Array<{
    id: string;
    statement: string;
    prior: number | null;
    prior_semantics: string;
  }> = [];

  for (const candidate of candidates) {
    const prior = hasQuantifiedPriors ? Number(candidate.prior) : null;
    const priorSemantics = prior === null ? UNKNOWN_PRIOR_SEMANTICS : SUBJECTIVE_PRIOR_SEMANTICS;
    const { data: hypothesis, error } = await supabase
      .from("aicis_hypotheses")
      .insert({
        statement: candidate.statement.trim(),
        status: "active",
        confidence: prior,
        confidence_semantics: priorSemantics,
        assumptions: candidate.assumptions ?? [],
        created_by: FN,
        metadata: {
          hypothesis_set_id: setRow.id,
          generated_as_candidate: true,
          trusted_fact: false,
          probability_semantics: priorSemantics,
          note: prior === null
            ? "No quantitative prior was supplied; hypothesis belief remains unquantified."
            : "Numeric prior is an explicitly supplied subjective modeling assumption, not an empirical probability.",
        },
      })
      .select("id,statement")
      .single();
    if (error || !hypothesis) return json({ error: "Failed to create hypothesis candidate" }, 500);

    const { error: memberError } = await supabase.from("aicis_hypothesis_set_members").insert({
      hypothesis_set_id: setRow.id,
      hypothesis_id: hypothesis.id,
      prior,
      prior_semantics: priorSemantics,
      normalized_probability: null,
      normalized_probability_semantics: null,
    });
    if (memberError) return json({ error: "Failed to register hypothesis candidate" }, 500);

    created.push({ id: hypothesis.id, statement: hypothesis.statement, prior, prior_semantics: priorSemantics });

    await supabase.from("aicis_cognitive_events").insert({
      event_type: "hypothesis.created",
      epistemic_status: "hypothesized",
      confidence: null,
      confidence_semantics: "not_quantified_event_record",
      subject_entity_id: body.subject_entity_id ?? null,
      occurred_at: now,
      observed_at: now,
      producer: FN,
      payload: {
        hypothesis_set_id: setRow.id,
        hypothesis_id: hypothesis.id,
        question,
        statement: hypothesis.statement,
        assumptions: candidate.assumptions ?? [],
        prior,
        prior_semantics: priorSemantics,
      },
      provenance: [{
        sourceId: `hypothesis-set:${setRow.id}`,
        sourceType: "hypothesis-generation",
        observedAt: now,
        extractor: FN,
        extractorVersion: "2",
      }],
    });
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_hypothesis_open",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Opened competition with ${created.length} hypotheses`,
    metadata: {
      hypothesis_set_id: setRow.id,
      question,
      auth_via: via,
      competition_semantics: competitionSemantics,
      quantitative_prior_count: suppliedPriorCount,
    },
  });

  return json({
    success: true,
    hypothesis_set_id: setRow.id,
    question,
    competition_semantics: competitionSemantics,
    probability_semantics: hasQuantifiedPriors ? SUBJECTIVE_PRIOR_SEMANTICS : UNKNOWN_PRIOR_SEMANTICS,
    candidates: created,
  });
});

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
