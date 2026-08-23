import type { ModelExecutionOutput } from "./modelExecution";

export interface TabularLogisticInput {
  features: Record<string, number>;
  coefficients: Record<string, number>;
  intercept: number;
}

export interface TemporalSeriesInput {
  values: number[];
}

export interface BaselineComparison {
  challengerEligible: boolean;
  reasons: string[];
  relativeBrierImprovement: number | null;
  calibrationImprovement: number | null;
}

/**
 * Deterministic logistic baseline for already-trained coefficients. This is not
 * a trainer; it exists so tabular ANN/tree challengers have a simple, auditable
 * reference model to beat.
 */
export function runLogisticBaseline(
  modelId: string,
  input: TabularLogisticInput,
  latencyMs = 0,
): ModelExecutionOutput {
  const linear = Object.entries(input.coefficients).reduce(
    (sum, [feature, coefficient]) => sum + coefficient * (input.features[feature] ?? 0),
    input.intercept,
  );
  const probability = sigmoid(linear);
  return {
    modelId,
    kind: "probability",
    value: probability,
    probability,
    confidence: 0.6,
    latencyMs: Math.max(0, latencyMs),
    metadata: { baseline: "logistic", linearScore: linear },
  };
}

/** Last-observation persistence: y(t+h) = y(t). */
export function runPersistenceBaseline(
  modelId: string,
  input: TemporalSeriesInput,
  latencyMs = 0,
): ModelExecutionOutput {
  const values = cleanSeries(input.values);
  if (values.length === 0) throw new Error("persistence baseline requires at least one finite value");
  const value = values[values.length - 1];
  return {
    modelId,
    kind: "numeric",
    value,
    confidence: values.length >= 8 ? 0.55 : 0.35,
    latencyMs: Math.max(0, latencyMs),
    metadata: { baseline: "persistence", observations: values.length },
  };
}

/** Simple local drift: extrapolate the average first difference one step. */
export function runDriftBaseline(
  modelId: string,
  input: TemporalSeriesInput,
  latencyMs = 0,
): ModelExecutionOutput {
  const values = cleanSeries(input.values);
  if (values.length < 2) throw new Error("drift baseline requires at least two finite values");
  const drift = (values[values.length - 1] - values[0]) / (values.length - 1);
  const value = values[values.length - 1] + drift;
  return {
    modelId,
    kind: "numeric",
    value,
    confidence: values.length >= 8 ? 0.5 : 0.3,
    latencyMs: Math.max(0, latencyMs),
    metadata: { baseline: "drift", observations: values.length, drift },
  };
}

/**
 * Conservative promotion gate. A challenger must improve probabilistic error
 * and must not materially worsen calibration. Sample-size requirements prevent
 * tiny benchmark wins from becoming production authority.
 */
export function compareChallengerToBaseline(input: {
  baselineBrier: number | null;
  challengerBrier: number | null;
  baselineEce: number | null;
  challengerEce: number | null;
  challengerSampleSize: number;
  highConsequence?: boolean;
  minimumRelativeBrierImprovement?: number;
  maximumCalibrationRegression?: number;
}): BaselineComparison {
  const reasons: string[] = [];
  const minimumSamples = input.highConsequence ? 250 : 75;
  if (input.challengerSampleSize < minimumSamples) {
    reasons.push(`insufficient evaluated cases: ${input.challengerSampleSize}/${minimumSamples}`);
  }

  let relativeBrierImprovement: number | null = null;
  if (
    input.baselineBrier !== null &&
    input.challengerBrier !== null &&
    input.baselineBrier > 0 &&
    Number.isFinite(input.baselineBrier) &&
    Number.isFinite(input.challengerBrier)
  ) {
    relativeBrierImprovement = (input.baselineBrier - input.challengerBrier) / input.baselineBrier;
    const required = input.minimumRelativeBrierImprovement ?? 0.05;
    if (relativeBrierImprovement < required) {
      reasons.push(`Brier improvement ${(relativeBrierImprovement * 100).toFixed(1)}% is below required ${(required * 100).toFixed(1)}%`);
    }
  } else {
    reasons.push("comparable Brier evidence is unavailable");
  }

  let calibrationImprovement: number | null = null;
  if (
    input.baselineEce !== null &&
    input.challengerEce !== null &&
    Number.isFinite(input.baselineEce) &&
    Number.isFinite(input.challengerEce)
  ) {
    calibrationImprovement = input.baselineEce - input.challengerEce;
    const maxRegression = input.maximumCalibrationRegression ?? 0.01;
    if (calibrationImprovement < -maxRegression) {
      reasons.push(`calibration regressed by ${Math.abs(calibrationImprovement).toFixed(4)}`);
    }
  } else {
    reasons.push("comparable calibration evidence is unavailable");
  }

  return {
    challengerEligible: reasons.length === 0,
    reasons,
    relativeBrierImprovement,
    calibrationImprovement,
  };
}

function cleanSeries(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}
