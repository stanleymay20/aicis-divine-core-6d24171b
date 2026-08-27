import { hasUsableNumericSemantics } from "./contracts";

export interface ProbabilisticForecast {
  probability: number | null;
  probabilitySemantics?: string;
  outcome?: 0 | 1;
  modelName?: string;
  weight?: number | null;
  weightSemantics?: string;
}

export interface CalibrationBucket {
  lower: number;
  upper: number;
  forecastCount: number;
  resolvedCount: number;
  meanPrediction: number | null;
  observedFrequency: number | null;
  absoluteCalibrationError: number | null;
}

export interface EnsembleResult {
  probability: number | null;
  probabilitySemantics: string;
  disagreement: number | null;
  disagreementSemantics: string;
  confidence: null;
  confidenceSemantics: string;
  usableMemberCount: number;
  aggregationStatus: "issued" | "abstained";
  reasons: string[];
}

export interface ReliabilityContext {
  sensingCoverage: number | null;
  sensingCoverageSemantics?: string;
  sourceDiversity: number | null;
  sourceDiversitySemantics?: string;
  extractionReliability: number | null;
  extractionReliabilitySemantics?: string;
  modelReliability: number | null;
  modelReliabilitySemantics?: string;
  freshness: number | null;
  freshnessSemantics?: string;
}

export interface OperationalReliabilityAssessment {
  score: number | null;
  semantics: string;
  evidenceStatus: "complete" | "incomplete";
  missingFactors: string[];
}

export interface EvidenceEscalationAssessment {
  escalate: boolean;
  reasons: string[];
  disagreement: number | null;
  operationalReliability: number | null;
  policySemantics: string;
}

const PROBABILITY_SEMANTICS = "validated_probabilistic_output";
const ENSEMBLE_PROBABILITY_SEMANTICS =
  "weighted_pool_of_explicit_probabilities_not_ensemble_calibration";
const DISAGREEMENT_SEMANTICS =
  "weighted_standard_deviation_of_usable_member_probabilities_not_confidence";
const OPERATIONAL_RELIABILITY_SEMANTICS =
  "geometric_mean_operator_health_heuristic_not_epistemic_probability";
const ESCALATION_POLICY_SEMANTICS =
  "deterministic_operator_evidence_escalation_policy_not_probability";

/** Brier score is defined only for a valid probability and a realized binary outcome. */
export function brierScore(probability: number, outcome: 0 | 1): number {
  if (!isUnitInterval(probability)) {
    throw new Error("Brier score requires a finite probability between 0 and 1");
  }
  return (probability - outcome) ** 2;
}

export function meanBrierScore(forecasts: ProbabilisticForecast[]): number | null {
  const resolved = forecasts.filter(isUsableResolvedProbability);
  if (resolved.length === 0) return null;
  return resolved.reduce(
    (sum, forecast) => sum + brierScore(forecast.probability as number, forecast.outcome as 0 | 1),
    0,
  ) / resolved.length;
}

/**
 * Reliability-diagram data. Only forecasts with semantics that establish a
 * probabilistic interpretation enter numeric calibration analysis. Unresolved
 * forecasts remain visible in forecastCount but never dilute resolved weighting.
 */
export function calibrationBuckets(
  forecasts: ProbabilisticForecast[],
  bucketCount = 10,
): CalibrationBucket[] {
  if (!Number.isInteger(bucketCount) || bucketCount < 2 || bucketCount > 100) {
    throw new Error("bucketCount must be an integer between 2 and 100");
  }

  const usable = forecasts.filter(isUsableProbability);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    lower: index / bucketCount,
    upper: (index + 1) / bucketCount,
    forecasts: [] as ProbabilisticForecast[],
  }));

  for (const forecast of usable) {
    const probability = forecast.probability as number;
    const index = Math.min(bucketCount - 1, Math.floor(probability * bucketCount));
    buckets[index].forecasts.push(forecast);
  }

  return buckets.map(({ lower, upper, forecasts: entries }) => {
    const resolved = entries.filter(isUsableResolvedProbability);
    const meanPrediction = resolved.length === 0
      ? null
      : resolved.reduce((sum, entry) => sum + (entry.probability as number), 0) / resolved.length;
    const observedFrequency = resolved.length === 0
      ? null
      : resolved.reduce((sum, entry) => sum + (entry.outcome as 0 | 1), 0) / resolved.length;

    return {
      lower,
      upper,
      forecastCount: entries.length,
      resolvedCount: resolved.length,
      meanPrediction,
      observedFrequency,
      absoluteCalibrationError:
        meanPrediction === null || observedFrequency === null
          ? null
          : Math.abs(meanPrediction - observedFrequency),
    };
  });
}

/** ECE weighted strictly by resolved usable probabilistic observations. */
export function expectedCalibrationError(
  forecasts: ProbabilisticForecast[],
  bucketCount = 10,
): number | null {
  const buckets = calibrationBuckets(forecasts, bucketCount);
  const resolvedCount = buckets.reduce((sum, bucket) => sum + bucket.resolvedCount, 0);
  if (resolvedCount === 0) return null;

  return buckets.reduce((sum, bucket) => {
    if (bucket.absoluteCalibrationError === null || bucket.resolvedCount === 0) return sum;
    return sum + (bucket.resolvedCount / resolvedCount) * bucket.absoluteCalibrationError;
  }, 0);
}

/**
 * Combine only explicitly probabilistic outputs with explicit, semantically usable
 * positive weights. No member receives an implicit weight of 1 and disagreement
 * is never transformed into synthetic confidence.
 */
export function ensembleForecast(forecasts: ProbabilisticForecast[]): EnsembleResult {
  const usable = forecasts.filter((forecast) =>
    isUsableProbability(forecast) &&
    isPositiveFinite(forecast.weight) &&
    hasUsableNumericSemantics(forecast.weightSemantics)
  );
  const reasons: string[] = [];

  if (usable.length === 0) {
    return {
      probability: null,
      probabilitySemantics: "not_issued_no_usable_weighted_probabilistic_members",
      disagreement: null,
      disagreementSemantics: DISAGREEMENT_SEMANTICS,
      confidence: null,
      confidenceSemantics: "not_issued_disagreement_is_not_confidence",
      usableMemberCount: 0,
      aggregationStatus: "abstained",
      reasons: ["No forecast has both usable probability semantics and an explicit usable positive weight"],
    };
  }

  const totalWeight = usable.reduce((sum, item) => sum + (item.weight as number), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return {
      probability: null,
      probabilitySemantics: "not_issued_invalid_total_weight",
      disagreement: null,
      disagreementSemantics: DISAGREEMENT_SEMANTICS,
      confidence: null,
      confidenceSemantics: "not_issued_disagreement_is_not_confidence",
      usableMemberCount: usable.length,
      aggregationStatus: "abstained",
      reasons: ["Usable member weights do not produce a positive finite total"],
    };
  }

  const probability = usable.reduce(
    (sum, item) => sum + (item.probability as number) * (item.weight as number),
    0,
  ) / totalWeight;

  let disagreement: number | null = null;
  if (usable.length >= 2) {
    const variance = usable.reduce(
      (sum, item) => {
        const delta = (item.probability as number) - probability;
        return sum + (item.weight as number) * delta * delta;
      },
      0,
    ) / totalWeight;
    disagreement = Math.sqrt(Math.max(0, variance));
  } else {
    reasons.push("Only one usable member; disagreement is not defined");
  }

  if (usable.length < forecasts.length) {
    reasons.push(`${forecasts.length - usable.length} forecast(s) excluded from quantitative aggregation`);
  }

  return {
    probability,
    probabilitySemantics: ENSEMBLE_PROBABILITY_SEMANTICS,
    disagreement,
    disagreementSemantics: DISAGREEMENT_SEMANTICS,
    confidence: null,
    confidenceSemantics: "not_issued_disagreement_is_not_confidence",
    usableMemberCount: usable.length,
    aggregationStatus: "issued",
    reasons,
  };
}

/**
 * Operational health heuristic. Every factor requires explicit usable semantics;
 * incomplete telemetry yields NULL instead of a pessimistic or optimistic default.
 * Source diversity remains merely a diversity metric and must not be described as
 * source independence.
 */
export function operationalReliability(
  context: ReliabilityContext,
): OperationalReliabilityAssessment {
  const factors: Array<{
    name: string;
    value: number | null;
    semantics?: string;
  }> = [
    { name: "sensingCoverage", value: context.sensingCoverage, semantics: context.sensingCoverageSemantics },
    { name: "sourceDiversity", value: context.sourceDiversity, semantics: context.sourceDiversitySemantics },
    { name: "extractionReliability", value: context.extractionReliability, semantics: context.extractionReliabilitySemantics },
    { name: "modelReliability", value: context.modelReliability, semantics: context.modelReliabilitySemantics },
    { name: "freshness", value: context.freshness, semantics: context.freshnessSemantics },
  ];

  const missingFactors = factors
    .filter((factor) => !isUnitInterval(factor.value) || !hasUsableNumericSemantics(factor.semantics))
    .map((factor) => factor.name);

  if (missingFactors.length > 0) {
    return {
      score: null,
      semantics: OPERATIONAL_RELIABILITY_SEMANTICS,
      evidenceStatus: "incomplete",
      missingFactors,
    };
  }

  const numeric = factors.map((factor) => factor.value as number);
  if (numeric.some((value) => value === 0)) {
    return {
      score: 0,
      semantics: OPERATIONAL_RELIABILITY_SEMANTICS,
      evidenceStatus: "complete",
      missingFactors: [],
    };
  }

  const product = numeric.reduce((value, factor) => value * factor, 1);
  return {
    score: product ** (1 / numeric.length),
    semantics: OPERATIONAL_RELIABILITY_SEMANTICS,
    evidenceStatus: "complete",
    missingFactors: [],
  };
}

/** Model confidence is not adjusted by an arbitrary operational multiplier. */
export function reliabilityAdjustedConfidence(): null {
  return null;
}

export function modelDisagreement(forecasts: ProbabilisticForecast[]): number | null {
  return ensembleForecast(forecasts).disagreement;
}

/**
 * Deterministic escalation policy. Missing disagreement/reliability evidence itself
 * escalates because absence of evidence must never look like healthy agreement.
 */
export function shouldEscalateForEvidence(
  forecasts: ProbabilisticForecast[],
  reliability: ReliabilityContext,
  disagreementThreshold = 0.2,
  reliabilityThreshold = 0.65,
): EvidenceEscalationAssessment {
  if (!isUnitInterval(disagreementThreshold) || !isUnitInterval(reliabilityThreshold)) {
    throw new Error("Escalation thresholds must be finite values between 0 and 1");
  }

  const disagreement = modelDisagreement(forecasts);
  const operational = operationalReliability(reliability);
  const reasons: string[] = [];

  if (disagreement === null) reasons.push("Model disagreement is not measurable from the available weighted probabilistic members");
  else if (disagreement >= disagreementThreshold) reasons.push("Measured model disagreement exceeds the operator policy threshold");

  if (operational.score === null) reasons.push(`Operational reliability is incomplete: ${operational.missingFactors.join(", ")}`);
  else if (operational.score < reliabilityThreshold) reasons.push("Operational reliability heuristic is below the operator policy threshold");

  return {
    escalate: reasons.length > 0,
    reasons,
    disagreement,
    operationalReliability: operational.score,
    policySemantics: ESCALATION_POLICY_SEMANTICS,
  };
}

function isUsableProbability(forecast: ProbabilisticForecast): boolean {
  return isUnitInterval(forecast.probability) && isProbabilitySemantics(forecast.probabilitySemantics);
}

function isUsableResolvedProbability(
  forecast: ProbabilisticForecast,
): forecast is ProbabilisticForecast & { probability: number; outcome: 0 | 1 } {
  return isUsableProbability(forecast) && (forecast.outcome === 0 || forecast.outcome === 1);
}

function isProbabilitySemantics(semantics: string | undefined): boolean {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  if (
    normalized.includes("not_probability") ||
    normalized.includes("not_probabilistic") ||
    normalized.includes("screen") ||
    normalized.includes("heuristic") ||
    normalized.includes("legacy") ||
    normalized.includes("unknown") ||
    normalized.includes("unspecified")
  ) return false;
  return normalized.includes("probability") || normalized.includes("probabilistic") || normalized === PROBABILITY_SEMANTICS;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
