import type { CognitiveModality, CognitiveTask, ModelFamily } from "./modelRouter";

export type PredictionKind = "probability" | "numeric" | "label" | "structured";

export interface ModelExecutionInput {
  routingDecisionId: string;
  modelId: string;
  family: ModelFamily;
  modality: CognitiveModality;
  task: CognitiveTask;
  inputHash: string;
  highConsequence?: boolean;
}

export interface ModelExecutionOutput {
  modelId: string;
  kind: PredictionKind;
  value: number | string | Record<string, unknown>;
  probability?: number;
  confidence: number;
  latencyMs: number;
  evidenceClaimIds?: string[];
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProbabilisticEnsembleResult {
  probability: number;
  confidence: number;
  disagreement: number;
  spread: number;
  memberCount: number;
  highDisagreement: boolean;
}

/**
 * Combines probabilistic specialist outputs without hiding disagreement.
 * Weights reflect independently measured competence/reliability supplied by the
 * caller; a model cannot increase its own authority through its output.
 */
export function aggregateProbabilisticOutputs(
  members: Array<{ output: ModelExecutionOutput; weight: number }>,
  disagreementThreshold = 0.18,
): ProbabilisticEnsembleResult {
  const usable = members.filter(
    ({ output, weight }) =>
      output.probability !== undefined &&
      Number.isFinite(output.probability) &&
      Number.isFinite(weight) &&
      weight > 0,
  );

  if (usable.length === 0) {
    return {
      probability: 0.5,
      confidence: 0,
      disagreement: 1,
      spread: 1,
      memberCount: 0,
      highDisagreement: true,
    };
  }

  const totalWeight = usable.reduce((sum, member) => sum + member.weight, 0);
  const probability = usable.reduce(
    (sum, member) => sum + clamp01(member.output.probability ?? 0.5) * member.weight,
    0,
  ) / totalWeight;

  const variance = usable.reduce((sum, member) => {
    const delta = clamp01(member.output.probability ?? 0.5) - probability;
    return sum + member.weight * delta * delta;
  }, 0) / totalWeight;

  const probabilities = usable.map((member) => clamp01(member.output.probability ?? 0.5));
  const spread = Math.max(...probabilities) - Math.min(...probabilities);
  const disagreement = clamp01(Math.sqrt(variance) * 2);

  const memberConfidence = usable.reduce(
    (sum, member) => sum + clamp01(member.output.confidence) * member.weight,
    0,
  ) / totalWeight;

  const confidence = clamp01(memberConfidence * (1 - disagreement));

  return {
    probability: clamp01(probability),
    confidence,
    disagreement,
    spread: clamp01(spread),
    memberCount: usable.length,
    highDisagreement: disagreement >= disagreementThreshold || spread >= disagreementThreshold * 2,
  };
}

export function assertExecutionMatchesRoute(
  expectedModelIds: string[],
  outputs: ModelExecutionOutput[],
): { valid: boolean; unauthorizedModelIds: string[]; missingModelIds: string[] } {
  const expected = new Set(expectedModelIds);
  const received = new Set(outputs.map((output) => output.modelId));
  const unauthorizedModelIds = [...received].filter((modelId) => !expected.has(modelId));
  const missingModelIds = [...expected].filter((modelId) => !received.has(modelId));
  return {
    valid: unauthorizedModelIds.length === 0 && missingModelIds.length === 0,
    unauthorizedModelIds,
    missingModelIds,
  };
}

export function confidencePenaltyForWarnings(warnings: string[] | undefined): number {
  if (!warnings?.length) return 1;
  return clamp01(1 - Math.min(0.5, warnings.length * 0.08));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
