import type { EpistemicStatus } from "./contracts";

export type HypothesisState = "active" | "supported" | "weakened" | "refuted" | "retired";

export interface HypothesisCandidate {
  id: string;
  statement: string;
  prior: number;
  confidence: number;
  status: HypothesisState;
  assumptions?: string[];
}

export interface HypothesisEvidence {
  id: string;
  claimId?: string;
  observedAt: string;
  epistemicStatus: EpistemicStatus;
  reliability: number;
  // Degree to which the evidence would be expected if the hypothesis were true.
  likelihoodGivenHypothesis: number;
  // Degree to which the same evidence would be expected if the hypothesis were false.
  likelihoodGivenAlternative: number;
  directObservation?: boolean;
  description?: string;
}

export interface BeliefUpdate {
  hypothesisId: string;
  prior: number;
  posterior: number;
  delta: number;
  state: HypothesisState;
  evidenceWeight: number;
  reasons: string[];
}

export interface HypothesisCompetitionResult {
  updates: BeliefUpdate[];
  normalizedBeliefs: Array<{ hypothesisId: string; probability: number }>;
  entropy: number;
  leaderId?: string;
  margin: number;
  unresolved: boolean;
}

/**
 * Conservative Bayesian-style update. Evidence reliability attenuates the
 * likelihood ratio rather than allowing extractor/model confidence to become
 * factual certainty. Contradicted/unverified evidence is automatically limited.
 */
export function updateHypothesis(
  hypothesis: HypothesisCandidate,
  evidence: HypothesisEvidence[],
): BeliefUpdate {
  const prior = clampProbability(hypothesis.confidence || hypothesis.prior);
  let logOdds = Math.log(prior / (1 - prior));
  const reasons: string[] = [];
  let accumulatedWeight = 0;

  for (const item of evidence) {
    const statusWeight = epistemicWeight(item.epistemicStatus);
    const reliability = clamp01(item.reliability) * statusWeight;
    if (reliability <= 0) continue;

    const pEvidenceIfTrue = clampLikelihood(item.likelihoodGivenHypothesis);
    const pEvidenceIfFalse = clampLikelihood(item.likelihoodGivenAlternative);
    const logLikelihoodRatio = Math.log(pEvidenceIfTrue / pEvidenceIfFalse);

    // Reliability scales evidential force; no single weakly verified item can
    // generate extreme posterior certainty.
    logOdds += logLikelihoodRatio * reliability;
    accumulatedWeight += Math.abs(logLikelihoodRatio) * reliability;

    if (logLikelihoodRatio > 0.35) reasons.push(`Evidence ${item.id} supports the hypothesis`);
    else if (logLikelihoodRatio < -0.35) reasons.push(`Evidence ${item.id} weakens the hypothesis`);
  }

  const posterior = clampProbability(1 / (1 + Math.exp(-logOdds)));
  const delta = posterior - prior;
  const state = classifyHypothesisState(hypothesis.status, posterior, delta, accumulatedWeight);

  if (evidence.length === 0) reasons.push("No new evidence available; belief unchanged");
  if (posterior > 0.95) reasons.push("Posterior capped below certainty; residual uncertainty remains");

  return {
    hypothesisId: hypothesis.id,
    prior,
    posterior,
    delta,
    state,
    evidenceWeight: accumulatedWeight,
    reasons,
  };
}

/**
 * Competes hypotheses without forcing probabilities to sum to one internally.
 * The normalized view is presentation/ranking only; hypotheses may overlap or
 * all be wrong, so each raw posterior remains independently preserved.
 */
export function competeHypotheses(
  hypotheses: HypothesisCandidate[],
  evidenceByHypothesis: Record<string, HypothesisEvidence[]>,
): HypothesisCompetitionResult {
  const updates = hypotheses.map((hypothesis) =>
    updateHypothesis(hypothesis, evidenceByHypothesis[hypothesis.id] ?? []),
  );

  const active = updates.filter((item) => item.state !== "refuted" && item.state !== "retired");
  const denominator = active.reduce((sum, item) => sum + item.posterior, 0);
  const normalizedBeliefs = active
    .map((item) => ({
      hypothesisId: item.hypothesisId,
      probability: denominator > 0 ? item.posterior / denominator : 0,
    }))
    .sort((a, b) => b.probability - a.probability);

  const entropy = normalizedEntropy(normalizedBeliefs.map((item) => item.probability));
  const first = normalizedBeliefs[0]?.probability ?? 0;
  const second = normalizedBeliefs[1]?.probability ?? 0;
  const margin = first - second;

  return {
    updates,
    normalizedBeliefs,
    entropy,
    leaderId: normalizedBeliefs[0]?.hypothesisId,
    margin,
    unresolved: normalizedBeliefs.length > 1 && (margin < 0.2 || entropy > 0.65),
  };
}

export interface EvidenceRequest {
  hypothesisId: string;
  priority: number;
  rationale: string;
  target: "support" | "contradiction" | "mechanism" | "temporal" | "counterfactual";
}

/** Prioritizes missing evidence that is most likely to discriminate contenders. */
export function proposeDiscriminatingEvidence(
  competition: HypothesisCompetitionResult,
  evidenceByHypothesis: Record<string, HypothesisEvidence[]>,
): EvidenceRequest[] {
  const contenders = competition.normalizedBeliefs.slice(0, 3);
  const requests: EvidenceRequest[] = [];

  for (const contender of contenders) {
    const evidence = evidenceByHypothesis[contender.hypothesisId] ?? [];
    const hasDirect = evidence.some((item) => item.directObservation && epistemicWeight(item.epistemicStatus) >= 0.8);
    const hasStrongContradiction = evidence.some(
      (item) => item.likelihoodGivenHypothesis + 0.25 < item.likelihoodGivenAlternative,
    );
    const hasTemporal = evidence.some((item) => /temporal|preced|before|after/i.test(item.description ?? ""));
    const hasMechanism = evidence.some((item) => /mechanism|pathway|transmission/i.test(item.description ?? ""));

    if (!hasDirect) requests.push({
      hypothesisId: contender.hypothesisId,
      priority: 0.95 * contender.probability,
      target: "support",
      rationale: "Seek independent direct observation rather than additional model-generated agreement",
    });
    if (!hasStrongContradiction) requests.push({
      hypothesisId: contender.hypothesisId,
      priority: 0.85 * contender.probability,
      target: "contradiction",
      rationale: "Actively search for evidence that would falsify the leading explanation",
    });
    if (!hasTemporal) requests.push({
      hypothesisId: contender.hypothesisId,
      priority: 0.75 * contender.probability,
      target: "temporal",
      rationale: "Establish whether the proposed cause precedes the claimed consequence",
    });
    if (!hasMechanism) requests.push({
      hypothesisId: contender.hypothesisId,
      priority: 0.7 * contender.probability,
      target: "mechanism",
      rationale: "Seek a plausible evidenced transmission mechanism",
    });
  }

  return requests.sort((a, b) => b.priority - a.priority);
}

function classifyHypothesisState(
  current: HypothesisState,
  posterior: number,
  delta: number,
  evidenceWeight: number,
): HypothesisState {
  if (current === "retired") return current;
  if (posterior <= 0.08 && evidenceWeight >= 1) return "refuted";
  if (posterior >= 0.75 && evidenceWeight >= 1) return "supported";
  if (delta <= -0.15 && evidenceWeight >= 0.5) return "weakened";
  return "active";
}

function epistemicWeight(status: EpistemicStatus): number {
  switch (status) {
    case "observed": return 1;
    case "derived": return 0.9;
    case "inferred": return 0.7;
    case "predicted": return 0.45;
    case "hypothesized": return 0.3;
    case "simulated": return 0.35;
    case "unverified": return 0.2;
    case "contradicted": return 0.1;
  }
}

function normalizedEntropy(probabilities: number[]): number {
  if (probabilities.length <= 1) return 0;
  const entropy = -probabilities.reduce(
    (sum, probability) => probability > 0 ? sum + probability * Math.log(probability) : sum,
    0,
  );
  return entropy / Math.log(probabilities.length);
}

function clampLikelihood(value: number): number {
  return Math.min(0.99, Math.max(0.01, Number.isFinite(value) ? value : 0.5));
}

function clampProbability(value: number): number {
  return Math.min(0.995, Math.max(0.005, Number.isFinite(value) ? value : 0.5));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
