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
 * a trainer and its raw sigmoid output is not assumed calibrated merely because
 * it lies in [0,1]. Every coefficient feature must be present; missing features
 * are never silently converted to zero.
 */
export function runLogisticBaseline(
  modelId: string,
  input: TabularLogisticInput,
  latencyMs: number | null = null,
): ModelExecutionOutput {
  const coefficientEntries = Object.entries(input.coefficients);
  const missingFeatures = coefficientEntries
    .map(([feature]) => feature)
    .filter((feature) => !Object.prototype.hasOwnProperty.call(input.features, feature));
  if (missingFeatures.length > 0) {
    throw new Error(`logistic baseline missing required feature(s): ${missingFeatures.join(", ")}`);
  }

  for (const [feature, coefficient] of coefficientEntries) {
    const value = input.features[feature];
    if (!Number.isFinite(coefficient) || !Number.isFinite(value)) {
      throw new Error(`logistic baseline requires finite coefficient and feature value for ${feature}`);
    }
  }
  if (!Number.isFinite(input.intercept)) {
    throw new Error("logistic baseline requires a finite intercept");
  }

  const linear = coefficientEntries.reduce(
    (sum, [feature, coefficient]) => sum + coefficient * input.features[feature],
    input.intercept,
  );
  const probability = sigmoid(linear);
  return {
    modelId,
    kind: "probability",
    value: probability,
    probability,
    probabilitySemantics: "raw_logistic_model_output_not_assumed_calibrated",
    calibrationStatus: "not_proven_by_baseline_execution",
    confidence: null,
    confidenceSemantics: "not_issued_deterministic_execution_is_not_epistemic_confidence",
    latencyMs: normalizeLatency(latencyMs),
    latencySemantics: latencyMs === null
      ? "not_measured"
      : "caller_supplied_execution_latency_ms",
    evidenceStatus: "complete_required_feature_vector",
    metadata: {
      baseline: "logistic",
      linearScore: linear,
      featureCount: coefficientEntries.length,
      deterministicBaseline: true,
    },
  };
}

/** Last-observation persistence: y(t+h) = y(t). Deterministic rule, no confidence issued. */
export function runPersistenceBaseline(
  modelId: string,
  input: TemporalSeriesInput,
  latencyMs: number | null = null,
): ModelExecutionOutput {
  const values = cleanSeries(input.values);
  if (values.length === 0) throw new Error("persistence baseline requires at least one finite value");
  if (values.length !== input.values.length) {
    throw new Error("persistence baseline does not accept missing/non-finite series values");
  }
  const value = values[values.length - 1];
  return {
    modelId,
    kind: "numeric",
    value,
    confidence: null,
    confidenceSemantics: "not_issued_observation_count_is_not_forecast_confidence",
    latencyMs: normalizeLatency(latencyMs),
    latencySemantics: latencyMs === null
      ? "not_measured"
      : "caller_supplied_execution_latency_ms",
    evidenceStatus: "complete_supplied_series",
    metadata: {
      baseline: "persistence",
      observations: values.length,
      deterministicBaseline: true,
      forecastSemantics: "last_observation_persistence_rule_not_probabilistic_forecast",
    },
  };
}

/** Simple local drift: extrapolate average first difference one step. No confidence issued. */
export function runDriftBaseline(
  modelId: string,
  input: TemporalSeriesInput,
  latencyMs: number | null = null,
): ModelExecutionOutput {
  const values = cleanSeries(input.values);
  if (values.length < 2) throw new Error("drift baseline requires at least two finite values");
  if (values.length !== input.values.length) {
    throw new Error("drift baseline does not accept missing/non-finite series values");
  }
  const drift = (values[values.length - 1] - values[0]) / (values.length - 1);
  const value = values[values.length - 1] + drift;
  return {
    modelId,
    kind: "numeric",
    value,
    confidence: null,
    confidenceSemantics: "not_issued_observation_count_is_not_forecast_confidence",
    latencyMs: normalizeLatency(latencyMs),
    latencySemantics: latencyMs === null
      ? "not_measured"
      : "caller_supplied_execution_latency_ms",
    evidenceStatus: "complete_supplied_series",
    metadata: {
      baseline: "drift",
      observations: values.length,
      drift,
      deterministicBaseline: true,
      forecastSemantics: "linear_local_drift_rule_not_probabilistic_forecast",
    },
  };
}

/**
 * Conservative promotion gate. A challenger must improve probabilistic error
 * and must not materially worsen calibration. Sample-size requirements prevent
 * tiny benchmark wins from becoming production authority. Thresholds are policy
 * thresholds, not claims of statistical significance.
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
      reasons.push(`Brier improvement ${(relativeBrierImprovement * 100).toFixed(1)}% is below required policy threshold ${(required * 100).toFixed(1)}%`);
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

function normalizeLatency(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("latency must be a finite non-negative number when supplied");
  }
  return value;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}
