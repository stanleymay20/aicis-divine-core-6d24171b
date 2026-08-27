import type { CognitiveModality, CognitiveTask, ModelFamily } from "./modelRouter";
import { hasUsableNumericSemantics } from "./contracts";

export type PredictionKind = "probability" | "numeric" | "label" | "structured";

const ENSEMBLE_PROBABILITY_SEMANTICS =
  "weighted_pool_of_explicit_member_probabilities_ensemble_not_calibrated";
const ENSEMBLE_CONFIDENCE_SEMANTICS =
  "not_issued_member_self_reported_confidence_not_aggregated";
const DISAGREEMENT_SEMANTICS =
  "weighted_standard_deviation_and_range_of_usable_member_probabilities_not_confidence";

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
  probability?: number | null;
  probabilitySemantics?: string;
  calibrationStatus?: string;
  confidence: number | null;
  confidenceSemantics?: string;
  latencyMs: number | null;
  latencySemantics?: string;
  evidenceStatus?: string;
  evidenceClaimIds?: string[];
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProbabilisticEnsembleMember {
  output: ModelExecutionOutput;
  weight: number | null;
  weightSemantics?: string;
}

export interface ProbabilisticEnsembleResult {
  probability: number | null;
  probabilitySemantics: string;
  calibrationStatus: "ensemble_not_calibrated" | "not_applicable_no_output";
  confidence: null;
  confidenceSemantics: string;
  disagreement: number | null;
  spread: number | null;
  disagreementSemantics: string;
  memberCount: number;
  usableMemberCount: number;
  highDisagreement: boolean | null;
  aggregationStatus: "issued" | "abstained";
  withheldReasons: string[];
}

/**
 * Pools explicitly probabilistic specialist outputs without manufacturing neutral
 * probabilities, confidence, or weights. A member is usable only when:
 * - its probability is a finite [0,1] value;
 * - its probability semantics actually describe a probability rather than a score;
 * - its routing/quality weight is explicit and semantically usable.
 *
 * The pooled result is not automatically calibrated at the ensemble level.
 */
export function aggregateProbabilisticOutputs(
  members: ProbabilisticEnsembleMember[],
  disagreementThreshold = 0.18,
): ProbabilisticEnsembleResult {
  const threshold = isUnitInterval(disagreementThreshold) ? disagreementThreshold : 0.18;
  const usable = members.filter(({ output, weight, weightSemantics }) =>
    isUnitInterval(output.probability) &&
    isProbabilitySemantics(output.probabilitySemantics) &&
    isPositiveFinite(weight) &&
    hasUsableNumericSemantics(weightSemantics)
  );

  const withheldReasons: string[] = [];
  if (members.length === 0) withheldReasons.push("no ensemble members supplied");
  if (members.length > 0 && usable.length === 0) {
    withheldReasons.push("no member has both usable probability semantics and a usable explicit weight");
  }

  if (usable.length === 0) {
    return {
      probability: null,
      probabilitySemantics: "not_issued_no_usable_probabilistic_members",
      calibrationStatus: "not_applicable_no_output",
      confidence: null,
      confidenceSemantics: ENSEMBLE_CONFIDENCE_SEMANTICS,
      disagreement: null,
      spread: null,
      disagreementSemantics: DISAGREEMENT_SEMANTICS,
      memberCount: members.length,
      usableMemberCount: 0,
      highDisagreement: null,
      aggregationStatus: "abstained",
      withheldReasons,
    };
  }

  const totalWeight = usable.reduce((sum, member) => sum + Number(member.weight), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return {
      probability: null,
      probabilitySemantics: "not_issued_invalid_total_weight",
      calibrationStatus: "not_applicable_no_output",
      confidence: null,
      confidenceSemantics: ENSEMBLE_CONFIDENCE_SEMANTICS,
      disagreement: null,
      spread: null,
      disagreementSemantics: DISAGREEMENT_SEMANTICS,
      memberCount: members.length,
      usableMemberCount: usable.length,
      highDisagreement: null,
      aggregationStatus: "abstained",
      withheldReasons: ["usable member weights do not produce a positive finite total"],
    };
  }

  const probability = usable.reduce(
    (sum, member) => sum + Number(member.output.probability) * Number(member.weight),
    0,
  ) / totalWeight;

  let disagreement: number | null = null;
  let spread: number | null = null;
  let highDisagreement: boolean | null = null;
  if (usable.length >= 2) {
    const variance = usable.reduce((sum, member) => {
      const delta = Number(member.output.probability) - probability;
      return sum + Number(member.weight) * delta * delta;
    }, 0) / totalWeight;
    const probabilities = usable.map((member) => Number(member.output.probability));
    disagreement = clamp01(Math.sqrt(Math.max(0, variance)) * 2);
    spread = clamp01(Math.max(...probabilities) - Math.min(...probabilities));
    highDisagreement = disagreement >= threshold || spread >= threshold * 2;
  }

  if (usable.length < members.length) {
    withheldReasons.push(`${members.length - usable.length} member(s) excluded from quantitative pooling`);
  }
  if (usable.length === 1) {
    withheldReasons.push("only one usable probabilistic member; disagreement statistics are not defined");
  }

  return {
    probability: clamp01(probability),
    probabilitySemantics: ENSEMBLE_PROBABILITY_SEMANTICS,
    calibrationStatus: "ensemble_not_calibrated",
    confidence: null,
    confidenceSemantics: ENSEMBLE_CONFIDENCE_SEMANTICS,
    disagreement,
    spread,
    disagreementSemantics: DISAGREEMENT_SEMANTICS,
    memberCount: members.length,
    usableMemberCount: usable.length,
    highDisagreement,
    aggregationStatus: "issued",
    withheldReasons,
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

/** Warning count is evidence metadata, not a calibrated confidence penalty. */
export function summarizeWarnings(warnings: string[] | undefined): {
  warningCount: number;
  confidenceAdjustment: null;
  semantics: string;
} {
  return {
    warningCount: warnings?.length ?? 0,
    confidenceAdjustment: null,
    semantics: "warning_count_recorded_no_calibrated_confidence_penalty",
  };
}

function isProbabilitySemantics(semantics: string | undefined): boolean {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  if (
    normalized.includes("not_probability") ||
    normalized.includes("not_probabilistic") ||
    normalized.includes("screen") ||
    normalized.includes("heuristic") ||
    normalized.includes("uncalibrated") ||
    normalized.includes("legacy") ||
    normalized.includes("unknown") ||
    normalized.includes("unspecified")
  ) {
    return false;
  }
  return normalized.includes("probability") || normalized.includes("probabilistic");
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
