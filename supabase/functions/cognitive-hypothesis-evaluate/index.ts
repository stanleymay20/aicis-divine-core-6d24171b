import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-hypothesis-evaluate";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type HypothesisRow = {
  id: string;
  statement: string;
  status: string;
  confidence: number;
};

type MemberRow = {
  hypothesis_id: string;
  prior: number;
};

type EvidenceRow = {
  id: string;
  hypothesis_id: string;
  reliability: number;
  likelihood_given_hypothesis: number;
  likelihood_given_alternative: number;
  direct_observation: boolean;
  description: string | null;
  claim_id: string | null;
  cognitive_event_id: string | null;
};

type Update = {
  hypothesisId: string;
  prior: number;
  posterior: number;
  delta: number;
  evidenceWeight: number;
  previousStatus: string;
  newStatus: string;
  reasons: string[];
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
    .select("hypothesis_id,prior")
    .eq("hypothesis_set_id", setRow.id);
  if (memberError) return json({ error: "Failed to load hypothesis members" }, 500);
  if (!members?.length) return json({ error: "Hypothesis set has no members" }, 422);

  const hypothesisIds = (members as MemberRow[]).map((row) => row.hypothesis_id);
  const [{ data: hypotheses, error: hypothesisError }, { data: evidence, error: evidenceError }] = await Promise.all([
    supabase
      .from("aicis_hypotheses")
      .select("id,statement,status,confidence")
      .in("id", hypothesisIds),
    supabase
      .from("aicis_hypothesis_evidence")
      .select("id,hypothesis_id,reliability,likelihood_given_hypothesis,likelihood_given_alternative,direct_observation,description,claim_id,cognitive_event_id")
      .in("hypothesis_id", hypothesisIds),
  ]);

  if (hypothesisError || evidenceError) return json({ error: "Failed to load hypotheses or evidence" }, 500);

  const hypothesisMap = new Map((hypotheses as HypothesisRow[] ?? []).map((row) => [row.id, row]));
  const evidenceByHypothesis = new Map<string, EvidenceRow[]>();
  for (const item of (evidence as EvidenceRow[] ?? [])) {
    const list = evidenceByHypothesis.get(item.hypothesis_id) ?? [];
    list.push(item);
    evidenceByHypothesis.set(item.hypothesis_id, list);
  }

  const updates: Update[] = [];
  for (const member of members as MemberRow[]) {
    const hypothesis = hypothesisMap.get(member.hypothesis_id);
    if (!hypothesis) continue;
    const prior = clampProbability(Number(hypothesis.confidence ?? member.prior ?? 0.5));
    let logOdds = Math.log(prior / (1 - prior));
    let evidenceWeight = 0;
    const reasons: string[] = [];

    for (const item of evidenceByHypothesis.get(hypothesis.id) ?? []) {
      const reliability = clamp01(Number(item.reliability));
      const pTrue = clampLikelihood(Number(item.likelihood_given_hypothesis));
      const pFalse = clampLikelihood(Number(item.likelihood_given_alternative));
      const llr = Math.log(pTrue / pFalse);
      logOdds += llr * reliability;
      evidenceWeight += Math.abs(llr) * reliability;
      if (llr > 0.35) reasons.push(`Evidence ${item.id} supports`);
      if (llr < -0.35) reasons.push(`Evidence ${item.id} contradicts`);
    }

    const posterior = clampProbability(1 / (1 + Math.exp(-logOdds)));
    const delta = posterior - prior;
    const newStatus = classify(hypothesis.status, posterior, delta, evidenceWeight);
    updates.push({
      hypothesisId: hypothesis.id,
      prior,
      posterior,
      delta,
      evidenceWeight,
      previousStatus: hypothesis.status,
      newStatus,
      reasons: reasons.length ? reasons : ["No discriminating evidence changed the belief"],
    });
  }

  const active = updates.filter((row) => !["refuted", "retired"].includes(row.newStatus));
  const total = active.reduce((sum, row) => sum + row.posterior, 0);
  const normalized = active
    .map((row) => ({ hypothesisId: row.hypothesisId, probability: total > 0 ? row.posterior / total : 0 }))
    .sort((a, b) => b.probability - a.probability);
  const entropy = normalizedEntropy(normalized.map((row) => row.probability));
  const margin = (normalized[0]?.probability ?? 0) - (normalized[1]?.probability ?? 0);
  const unresolved = normalized.length > 1 && (margin < 0.2 || entropy > 0.65);
  const leaderId = normalized[0]?.hypothesisId ?? null;

  const timestamp = new Date().toISOString();
  for (const update of updates) {
    await supabase.from("aicis_hypotheses").update({
      confidence: update.posterior,
      status: update.newStatus,
      updated_at: timestamp,
      resolved_at: ["refuted", "retired"].includes(update.newStatus) ? timestamp : null,
    }).eq("id", update.hypothesisId);

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
    });
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const item = normalized[index];
    await supabase.from("aicis_hypothesis_set_members").update({
      normalized_probability: item.probability,
      rank: index + 1,
    }).eq("hypothesis_set_id", setRow.id).eq("hypothesis_id", item.hypothesisId);
  }

  await supabase.from("aicis_hypothesis_sets").update({
    leader_hypothesis_id: leaderId,
    entropy,
    margin,
    unresolved,
    updated_at: timestamp,
  }).eq("id", setRow.id);

  // Replace only open/searching requests. Satisfied requests remain historical evidence of inquiry.
  await supabase.from("aicis_evidence_requests")
    .delete()
    .eq("hypothesis_set_id", setRow.id)
    .in("status", ["open", "searching"]);

  const requests = buildEvidenceRequests(normalized, evidenceByHypothesis);
  if (requests.length) {
    await supabase.from("aicis_evidence_requests").insert(requests.map((request) => ({
      hypothesis_set_id: setRow.id,
      ...request,
    })));
  }

  await supabase.from("aicis_cognitive_events").insert({
    event_type: "hypothesis.updated",
    epistemic_status: "derived",
    confidence: 1,
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
      requested_evidence: requests,
    },
    provenance: [{
      sourceId: `hypothesis-set:${setRow.id}`,
      sourceType: "derived-hypothesis-competition",
      observedAt: timestamp,
      extractor: FN,
      extractorVersion: "1",
    }],
  });

  await supabase.from("system_logs").insert({
    action: "cognitive_hypothesis_evaluate",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Evaluated ${updates.length} competing hypotheses`,
    metadata: { hypothesis_set_id: setRow.id, entropy, margin, unresolved, auth_via: via },
  });

  return json({
    success: true,
    hypothesis_set_id: setRow.id,
    leader_hypothesis_id: leaderId,
    entropy,
    margin,
    unresolved,
    updates,
    normalized,
    evidence_requests: requests,
  });
});

function buildEvidenceRequests(
  normalized: Array<{ hypothesisId: string; probability: number }>,
  evidenceByHypothesis: Map<string, EvidenceRow[]>,
) {
  const requests: Array<{ hypothesis_id: string; target: string; priority: number; rationale: string }> = [];
  for (const contender of normalized.slice(0, 3)) {
    const evidence = evidenceByHypothesis.get(contender.hypothesisId) ?? [];
    const hasDirect = evidence.some((item) => item.direct_observation && item.reliability >= 0.8);
    const hasContradiction = evidence.some((item) => item.likelihood_given_alternative > item.likelihood_given_hypothesis + 0.25);
    const hasTemporal = evidence.some((item) => /temporal|preced|before|after/i.test(item.description ?? ""));
    const hasMechanism = evidence.some((item) => /mechanism|pathway|transmission/i.test(item.description ?? ""));
    if (!hasDirect) requests.push({ hypothesis_id: contender.hypothesisId, target: "support", priority: clamp01(0.95 * contender.probability), rationale: "Seek an independent direct observation" });
    if (!hasContradiction) requests.push({ hypothesis_id: contender.hypothesisId, target: "contradiction", priority: clamp01(0.85 * contender.probability), rationale: "Search actively for falsifying evidence" });
    if (!hasTemporal) requests.push({ hypothesis_id: contender.hypothesisId, target: "temporal", priority: clamp01(0.75 * contender.probability), rationale: "Establish temporal order" });
    if (!hasMechanism) requests.push({ hypothesis_id: contender.hypothesisId, target: "mechanism", priority: clamp01(0.70 * contender.probability), rationale: "Seek an evidenced transmission mechanism" });
  }
  return requests.sort((a, b) => b.priority - a.priority);
}

function classify(current: string, posterior: number, delta: number, evidenceWeight: number) {
  if (current === "retired") return current;
  if (posterior <= 0.08 && evidenceWeight >= 1) return "refuted";
  if (posterior >= 0.75 && evidenceWeight >= 1) return "supported";
  if (delta <= -0.15 && evidenceWeight >= 0.5) return "weakened";
  return "active";
}

function normalizedEntropy(probabilities: number[]) {
  if (probabilities.length <= 1) return 0;
  const entropy = -probabilities.reduce((sum, probability) => probability > 0 ? sum + probability * Math.log(probability) : sum, 0);
  return clamp01(entropy / Math.log(probabilities.length));
}

function clampProbability(value: number) {
  return Math.min(0.995, Math.max(0.005, Number.isFinite(value) ? value : 0.5));
}
function clampLikelihood(value: number) {
  return Math.min(0.99, Math.max(0.01, Number.isFinite(value) ? value : 0.5));
}
function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}
