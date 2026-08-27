import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-hypothesis-evaluate";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUBJECTIVE_PRIOR_SEMANTICS = "operator_supplied_subjective_prior";
const SUBJECTIVE_EVIDENCE_SEMANTICS = "operator_supplied_subjective_likelihood_ratio_and_reliability";
const SUBJECTIVE_POSTERIOR_SEMANTICS = "subjective_bayesian_belief_from_explicit_assumptions_v1";
const PRIOR_ONLY_SEMANTICS = "subjective_prior_distribution_no_quantitative_evidence";
const STATUS_CLASSIFICATION_SEMANTICS = "deterministic_status_thresholds_over_subjective_belief_v1";

type HypothesisRow = {
  id: string;
  statement: string;
  status: string;
  confidence: number | null;
  confidence_semantics: string | null;
};

type MemberRow = {
  hypothesis_id: string;
  prior: number | null;
  prior_semantics: string | null;
};

type EvidenceRow = {
  id: string;
  hypothesis_id: string;
  stance: "supports" | "contradicts" | "context" | "discriminates";
  reliability: number | null;
  likelihood_given_hypothesis: number | null;
  likelihood_given_alternative: number | null;
  quantitative_semantics: string | null;
  direct_observation: boolean;
  description: string | null;
  claim_id: string | null;
  cognitive_event_id: string | null;
};

type Update = {
  hypothesisId: string;
  prior: number | null;
  posterior: number | null;
  delta: number | null;
  evidenceWeight: number | null;
  quantitativeEvidenceCount: number;
  qualitativeEvidenceCount: number;
  previousStatus: string;
  newStatus: string;
  probabilitySemantics: string | null;
  reasons: string[];
};

type DistributionRow = { hypothesisId: string; probability: number };

type EvidenceRequest = {
  hypothesis_id: string;
  target: string;
  priority: number | null;
  priority_semantics: string;
  rationale: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  let body: { hypothesis_set_id?: string } = {};
  try { body = await req.json(); } catch { /* body remains empty */ }
  if (!body.hypothesis_set_id) return json({ error: "hypothesis_set_id is required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: setRow, error: setError } = await supabase
    .from("aicis_hypothesis_sets")
    .select("id,question,status")
    .eq("id", body.hypothesis_set_id)
    .single();
  if (setError || !setRow) return json({ error: "Hypothesis set not found" }, 404);
  if (setRow.status !== "open") return json({ error: "Hypothesis set is not open" }, 409);

  const { data: members, error: memberError } = await supabase
    .from("aicis_hypothesis_set_members")
    .select("hypothesis_id,prior,prior_semantics")
    .eq("hypothesis_set_id", setRow.id);
  if (memberError) return json({ error: "Failed to load hypothesis members" }, 500);
  if (!members?.length) return json({ error: "Hypothesis set has no members" }, 422);

  const memberRows = members as MemberRow[];
  const hypothesisIds = memberRows.map((row) => row.hypothesis_id);
  const [{ data: hypotheses, error: hypothesisError }, { data: evidence, error: evidenceError }] = await Promise.all([
    supabase
      .from("aicis_hypotheses")
      .select("id,statement,status,confidence,confidence_semantics")
      .in("id", hypothesisIds),
    supabase
      .from("aicis_hypothesis_evidence")
      .select("id,hypothesis_id,stance,reliability,likelihood_given_hypothesis,likelihood_given_alternative,quantitative_semantics,direct_observation,description,claim_id,cognitive_event_id")
      .in("hypothesis_id", hypothesisIds),
  ]);

  if (hypothesisError || evidenceError) {
    return json({ error: "Failed to load hypotheses or evidence" }, 500);
  }

  const hypothesisMap = new Map(
    ((hypotheses as HypothesisRow[] | null) ?? []).map((row) => [row.id, row]),
  );
  const evidenceRows = ((evidence as EvidenceRow[] | null) ?? []);
  const evidenceByHypothesis = new Map<string, EvidenceRow[]>();
  for (const item of evidenceRows) {
    const list = evidenceByHypothesis.get(item.hypothesis_id) ?? [];
    list.push(item);
    evidenceByHypothesis.set(item.hypothesis_id, list);
  }

  const quantifiedPriorCount = memberRows.filter(hasExplicitPrior).length;
  const quantitativeEvidenceCount = evidenceRows.filter(isExplicitQuantitativeEvidence).length;
  const qualitativeEvidenceCount = evidenceRows.length - quantitativeEvidenceCount;
  const allPriorsExplicit = quantifiedPriorCount === memberRows.length;

  const updates: Update[] = [];
  for (const member of memberRows) {
    const hypothesis = hypothesisMap.get(member.hypothesis_id);
    if (!hypothesis) continue;

    const prior = hasExplicitPrior(member) ? Number(member.prior) : null;
    const allEvidence = evidenceByHypothesis.get(hypothesis.id) ?? [];
    const quantitativeEvidence = allEvidence.filter(isExplicitQuantitativeEvidence);
    const qualitativeCount = allEvidence.length - quantitativeEvidence.length;

    if (prior === null) {
      updates.push({
        hypothesisId: hypothesis.id,
        prior: null,
        posterior: null,
        delta: null,
        evidenceWeight: null,
        quantitativeEvidenceCount: quantitativeEvidence.length,
        qualitativeEvidenceCount: qualitativeCount,
        previousStatus: hypothesis.status,
        newStatus: hypothesis.status,
        probabilitySemantics: null,
        reasons: ["No explicit quantitative prior; numeric belief update abstained"],
      });
      continue;
    }

    let logOdds = Math.log(prior / (1 - prior));
    let evidenceWeight = 0;
    const reasons: string[] = [];

    for (const item of quantitativeEvidence) {
      const reliability = Number(item.reliability);
      const pTrue = Number(item.likelihood_given_hypothesis);
      const pFalse = Number(item.likelihood_given_alternative);
      const llr = Math.log(pTrue / pFalse);
      logOdds += llr * reliability;
      evidenceWeight += Math.abs(llr) * reliability;
      if (llr > 0) reasons.push(`Evidence ${item.id} contributes support under supplied assumptions`);
      if (llr < 0) reasons.push(`Evidence ${item.id} contributes contradiction under supplied assumptions`);
    }

    const posterior = quantitativeEvidence.length > 0
      ? logistic(logOdds)
      : prior;
    const delta = posterior - prior;
    const newStatus = quantitativeEvidence.length > 0
      ? classify(hypothesis.status, posterior, delta, evidenceWeight)
      : hypothesis.status;
    const probabilitySemantics = quantitativeEvidence.length > 0
      ? SUBJECTIVE_POSTERIOR_SEMANTICS
      : PRIOR_ONLY_SEMANTICS;

    if (qualitativeCount > 0) {
      reasons.push(`${qualitativeCount} qualitative evidence item(s) were retained but excluded from numeric updating`);
    }
    if (quantitativeEvidence.length === 0) {
      reasons.push("No explicit quantitative likelihood assumptions; posterior remains equal to supplied prior");
    }

    updates.push({
      hypothesisId: hypothesis.id,
      prior,
      posterior,
      delta,
      evidenceWeight,
      quantitativeEvidenceCount: quantitativeEvidence.length,
      qualitativeEvidenceCount: qualitativeCount,
      previousStatus: hypothesis.status,
      newStatus,
      probabilitySemantics,
      reasons,
    });
  }

  const activeQuantified = allPriorsExplicit
    ? updates.filter((row) => row.posterior !== null && !["refuted", "retired"].includes(row.newStatus))
    : [];
  const total = activeQuantified.reduce((sum, row) => sum + Number(row.posterior), 0);
  const normalized: DistributionRow[] = total > 0
    ? activeQuantified
      .map((row) => ({ hypothesisId: row.hypothesisId, probability: Number(row.posterior) / total }))
      .sort((a, b) => b.probability - a.probability)
    : [];

  const hasQuantifiedDistribution = normalized.length > 0 && allPriorsExplicit;
  const entropy = hasQuantifiedDistribution ? normalizedEntropy(normalized.map((row) => row.probability)) : null;
  const margin = hasQuantifiedDistribution
    ? (normalized[0]?.probability ?? 0) - (normalized[1]?.probability ?? 0)
    : null;
  const unresolved = !hasQuantifiedDistribution || normalized.length > 1 && (
    Number(margin) < 0.2 || Number(entropy) > 0.65
  );
  const leaderId = hasQuantifiedDistribution ? normalized[0]?.hypothesisId ?? null : null;
  const quantitativeUpdatePerformed = allPriorsExplicit && quantitativeEvidenceCount > 0;
  const probabilitySemantics = quantitativeUpdatePerformed
    ? SUBJECTIVE_POSTERIOR_SEMANTICS
    : allPriorsExplicit ? PRIOR_ONLY_SEMANTICS : null;

  const evaluationStatus = classifyEvaluationAttempt(
    memberRows.length,
    quantifiedPriorCount,
    quantitativeEvidenceCount,
    qualitativeEvidenceCount,
  );

  const timestamp = new Date().toISOString();
  if (allPriorsExplicit) {
    for (const update of updates) {
      if (update.posterior === null || update.prior === null) continue;

      await supabase.from("aicis_hypotheses").update({
        confidence: update.posterior,
        confidence_semantics: update.probabilitySemantics,
        status: update.newStatus,
        updated_at: timestamp,
        resolved_at: ["refuted", "retired"].includes(update.newStatus) ? timestamp : null,
      }).eq("id", update.hypothesisId);

      if (update.quantitativeEvidenceCount > 0) {
        await supabase.from("aicis_hypothesis_updates").insert({
          hypothesis_set_id: setRow.id,
          hypothesis_id: update.hypothesisId,
          prior: update.prior,
          posterior: update.posterior,
          delta: update.delta,
          evidence_weight: update.evidenceWeight,
          previous_status: update.previousStatus,
          new_status: update.newStatus,
          reason: update.reasons,
          probability_semantics: SUBJECTIVE_POSTERIOR_SEMANTICS,
        });
      }
    }
  }

  // Always clear stale distributions before writing the current evaluation state.
  await supabase.from("aicis_hypothesis_set_members").update({
    normalized_probability: null,
    normalized_probability_semantics: null,
    rank: null,
  }).eq("hypothesis_set_id", setRow.id);

  for (let index = 0; index < normalized.length; index += 1) {
    const item = normalized[index];
    await supabase.from("aicis_hypothesis_set_members").update({
      normalized_probability: item.probability,
      normalized_probability_semantics: probabilitySemantics,
      rank: index + 1,
    }).eq("hypothesis_set_id", setRow.id).eq("hypothesis_id", item.hypothesisId);
  }

  const competitionSemantics = hasQuantifiedDistribution
    ? `${probabilitySemantics}; ${STATUS_CLASSIFICATION_SEMANTICS}; entropy_and_margin_are_distribution_descriptors`
    : "unquantified_competition_no_numeric_leader";

  await supabase.from("aicis_hypothesis_sets").update({
    leader_hypothesis_id: leaderId,
    entropy,
    margin,
    unresolved,
    competition_semantics: competitionSemantics,
    updated_at: timestamp,
  }).eq("id", setRow.id);

  await supabase.from("aicis_hypothesis_evaluation_attempts").insert({
    hypothesis_set_id: setRow.id,
    status: evaluationStatus,
    member_count: memberRows.length,
    quantified_prior_count: quantifiedPriorCount,
    quantitative_evidence_count: quantitativeEvidenceCount,
    qualitative_evidence_count: qualitativeEvidenceCount,
    probability_semantics: probabilitySemantics,
    details: {
      quantitative_update_performed: quantitativeUpdatePerformed,
      idempotency_semantics: "recomputed_from_original_explicit_member_prior_and_current_evidence_set",
      excluded_legacy_or_qualitative_evidence_count: qualitativeEvidenceCount,
      status_classification_semantics: STATUS_CLASSIFICATION_SEMANTICS,
      leader_hypothesis_id: leaderId,
      entropy,
      margin,
      unresolved,
    },
  });

  // Replace only open/searching requests. Satisfied requests remain historical evidence of inquiry.
  await supabase.from("aicis_evidence_requests")
    .delete()
    .eq("hypothesis_set_id", setRow.id)
    .in("status", ["open", "searching"]);

  const contenders = hasQuantifiedDistribution
    ? normalized.slice(0, 3).map((row) => ({ hypothesisId: row.hypothesisId, probability: row.probability }))
    : memberRows.map((row) => ({ hypothesisId: row.hypothesis_id, probability: null }));
  const requests = buildEvidenceRequests(contenders, evidenceByHypothesis);
  if (requests.length) {
    await supabase.from("aicis_evidence_requests").insert(requests.map((request) => ({
      hypothesis_set_id: setRow.id,
      ...request,
    })));
  }

  await supabase.from("aicis_cognitive_events").insert({
    event_type: "hypothesis.updated",
    epistemic_status: "derived",
    confidence: null,
    confidence_semantics: "not_applicable_deterministic_evaluation_record",
    occurred_at: timestamp,
    observed_at: timestamp,
    producer: FN,
    payload: {
      hypothesis_set_id: setRow.id,
      question: setRow.question,
      leader_hypothesis_id: leaderId,
      entropy,
      margin,
      unresolved,
      normalized,
      probability_semantics: probabilitySemantics,
      evaluation_status: evaluationStatus,
      quantitative_update_performed: quantitativeUpdatePerformed,
      requested_evidence: requests,
    },
    provenance: [{
      sourceId: `hypothesis-set:${setRow.id}`,
      sourceType: "derived-hypothesis-competition",
      observedAt: timestamp,
      extractor: FN,
      extractorVersion: "2",
    }],
  });

  await supabase.from("system_logs").insert({
    action: "cognitive_hypothesis_evaluate",
    user_id: user?.id ?? null,
    log_level: "info",
    result: quantitativeUpdatePerformed
      ? `Evaluated ${updates.length} hypotheses using explicit subjective quantitative assumptions`
      : `Evaluated ${updates.length} hypotheses without fabricating missing quantitative assumptions`,
    metadata: {
      hypothesis_set_id: setRow.id,
      evaluation_status: evaluationStatus,
      probability_semantics: probabilitySemantics,
      quantitative_update_performed: quantitativeUpdatePerformed,
      quantified_prior_count: quantifiedPriorCount,
      quantitative_evidence_count: quantitativeEvidenceCount,
      qualitative_evidence_count: qualitativeEvidenceCount,
      entropy,
      margin,
      unresolved,
      auth_via: via,
    },
  });

  return json({
    success: true,
    hypothesis_set_id: setRow.id,
    leader_hypothesis_id: leaderId,
    entropy,
    margin,
    unresolved,
    evaluation_status: evaluationStatus,
    quantitative_update_performed: quantitativeUpdatePerformed,
    probability_semantics: probabilitySemantics,
    status_classification_semantics: STATUS_CLASSIFICATION_SEMANTICS,
    updates,
    normalized,
    evidence_requests: requests,
  });
});

function buildEvidenceRequests(
  contenders: Array<{ hypothesisId: string; probability: number | null }>,
  evidenceByHypothesis: Map<string, EvidenceRow[]>,
): EvidenceRequest[] {
  const requests: EvidenceRequest[] = [];
  for (const contender of contenders) {
    const evidence = evidenceByHypothesis.get(contender.hypothesisId) ?? [];
    const hasDirect = evidence.some((item) => item.direct_observation);
    const hasContradiction = evidence.some((item) => item.stance === "contradicts");
    const hasTemporal = evidence.some((item) => /temporal|preced|before|after/i.test(item.description ?? ""));
    const hasMechanism = evidence.some((item) => /mechanism|pathway|transmission/i.test(item.description ?? ""));
    const probability = contender.probability;
    const prioritySemantics = probability === null
      ? "unranked_evidence_request_no_quantified_belief"
      : "deterministic_search_priority_heuristic_from_subjective_belief";
    const priority = (multiplier: number) => probability === null ? null : clamp01(multiplier * probability);

    if (!hasDirect) requests.push({
      hypothesis_id: contender.hypothesisId,
      target: "support",
      priority: priority(0.95),
      priority_semantics: prioritySemantics,
      rationale: "Seek an independent direct observation",
    });
    if (!hasContradiction) requests.push({
      hypothesis_id: contender.hypothesisId,
      target: "contradiction",
      priority: priority(0.85),
      priority_semantics: prioritySemantics,
      rationale: "Search actively for falsifying evidence",
    });
    if (!hasTemporal) requests.push({
      hypothesis_id: contender.hypothesisId,
      target: "temporal",
      priority: priority(0.75),
      priority_semantics: prioritySemantics,
      rationale: "Establish temporal order",
    });
    if (!hasMechanism) requests.push({
      hypothesis_id: contender.hypothesisId,
      target: "mechanism",
      priority: priority(0.70),
      priority_semantics: prioritySemantics,
      rationale: "Seek an evidenced transmission mechanism",
    });
  }

  return requests.sort((a, b) => {
    if (a.priority === null && b.priority === null) return 0;
    if (a.priority === null) return 1;
    if (b.priority === null) return -1;
    return b.priority - a.priority;
  });
}

function classify(current: string, posterior: number, delta: number, evidenceWeight: number) {
  if (current === "retired") return current;
  if (posterior <= 0.08 && evidenceWeight >= 1) return "refuted";
  if (posterior >= 0.75 && evidenceWeight >= 1) return "supported";
  if (delta <= -0.15 && evidenceWeight >= 0.5) return "weakened";
  return "active";
}

function classifyEvaluationAttempt(
  memberCount: number,
  quantifiedPriorCount: number,
  quantitativeEvidenceCount: number,
  qualitativeEvidenceCount: number,
) {
  if (quantifiedPriorCount === 0 && quantitativeEvidenceCount === 0) return "qualitative_only";
  if (quantifiedPriorCount !== memberCount) return "insufficient_quantitative_priors";
  if (quantitativeEvidenceCount === 0) return "insufficient_quantitative_evidence";
  if (qualitativeEvidenceCount > 0) return "mixed_quantitative_coverage";
  return "quantified_subjective_belief_update";
}

function hasExplicitPrior(member: MemberRow) {
  return member.prior_semantics === SUBJECTIVE_PRIOR_SEMANTICS && isOpenProbability(member.prior);
}

function isExplicitQuantitativeEvidence(item: EvidenceRow) {
  return item.quantitative_semantics === SUBJECTIVE_EVIDENCE_SEMANTICS &&
    isUnitInterval(item.reliability) &&
    isOpenProbability(item.likelihood_given_hypothesis) &&
    isOpenProbability(item.likelihood_given_alternative);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isOpenProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
}

function normalizedEntropy(probabilities: number[]) {
  if (probabilities.length <= 1) return 0;
  const entropy = -probabilities.reduce(
    (sum, probability) => probability > 0 ? sum + probability * Math.log(probability) : sum,
    0,
  );
  return clamp01(entropy / Math.log(probabilities.length));
}

function logistic(logOdds: number) {
  return 1 / (1 + Math.exp(-logOdds));
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}
