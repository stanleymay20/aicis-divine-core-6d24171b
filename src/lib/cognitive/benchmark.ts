export interface BinaryForecastCase {
  probability: number;
  outcome: 0 | 1;
}

export interface ClaimEvaluationCase {
  supported: boolean;
  attributed: boolean;
  sourceCorrect?: boolean;
}

export interface EarlyWarningCase {
  detectedAt?: string;
  eventAt: string;
  falsePositive?: boolean;
}

export interface IntelligenceBenchmarkInput {
  forecasts?: BinaryForecastCase[];
  claims?: ClaimEvaluationCase[];
  earlyWarnings?: EarlyWarningCase[];
  causalAccuracy?: number;
  decisionUtility?: number;
}

export interface IntelligenceBenchmarkScore {
  brierScore: number | null;
  calibrationError: number | null;
  unsupportedClaimRate: number | null;
  attributionPrecision: number | null;
  medianLeadTimeHours: number | null;
  falseWarningRate: number | null;
  causalAccuracy: number | null;
  decisionUtility: number | null;
  composite: number | null;
}

/**
 * Comparable, model-agnostic benchmark metrics. Lower Brier/ECE/unsupported rates
 * are better; lead time is useful only when false warnings remain controlled.
 */
export function scoreIntelligenceBenchmark(
  input: IntelligenceBenchmarkInput,
): IntelligenceBenchmarkScore {
  const forecasts = input.forecasts ?? [];
  const claims = input.claims ?? [];
  const warnings = input.earlyWarnings ?? [];

  const brierScore = forecasts.length
    ? forecasts.reduce((sum, item) => sum + (clamp01(item.probability) - item.outcome) ** 2, 0) / forecasts.length
    : null;
  const calibrationError = forecasts.length ? expectedCalibrationError(forecasts, 10) : null;

  const unsupportedClaimRate = claims.length
    ? claims.filter((claim) => !claim.supported).length / claims.length
    : null;

  const attributed = claims.filter((claim) => claim.attributed);
  const attributionPrecision = attributed.length
    ? attributed.filter((claim) => claim.sourceCorrect !== false).length / attributed.length
    : null;

  const validLeadTimes = warnings
    .filter((item) => item.detectedAt && !item.falsePositive)
    .map((item) => {
      const detected = new Date(item.detectedAt as string).getTime();
      const event = new Date(item.eventAt).getTime();
      return Number.isFinite(detected) && Number.isFinite(event)
        ? Math.max(0, (event - detected) / 3_600_000)
        : Number.NaN;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const medianLeadTimeHours = validLeadTimes.length ? median(validLeadTimes) : null;
  const falseWarningRate = warnings.length
    ? warnings.filter((item) => item.falsePositive).length / warnings.length
    : null;

  const causalAccuracy = finiteUnit(input.causalAccuracy);
  const decisionUtility = finiteUnit(input.decisionUtility);

  const normalizedParts: Array<{ value: number; weight: number }> = [];
  if (brierScore !== null) normalizedParts.push({ value: 1 - clamp01(brierScore), weight: 0.18 });
  if (calibrationError !== null) normalizedParts.push({ value: 1 - clamp01(calibrationError), weight: 0.14 });
  if (unsupportedClaimRate !== null) normalizedParts.push({ value: 1 - clamp01(unsupportedClaimRate), weight: 0.2 });
  if (attributionPrecision !== null) normalizedParts.push({ value: clamp01(attributionPrecision), weight: 0.12 });
  if (falseWarningRate !== null) normalizedParts.push({ value: 1 - clamp01(falseWarningRate), weight: 0.1 });
  if (causalAccuracy !== null) normalizedParts.push({ value: causalAccuracy, weight: 0.14 });
  if (decisionUtility !== null) normalizedParts.push({ value: decisionUtility, weight: 0.12 });

  const totalWeight = normalizedParts.reduce((sum, item) => sum + item.weight, 0);
  const composite = totalWeight > 0
    ? normalizedParts.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
    : null;

  return {
    brierScore,
    calibrationError,
    unsupportedClaimRate,
    attributionPrecision,
    medianLeadTimeHours,
    falseWarningRate,
    causalAccuracy,
    decisionUtility,
    composite,
  };
}

export function expectedCalibrationError(cases: BinaryForecastCase[], bins = 10): number {
  if (cases.length === 0) return 0;
  const safeBins = Math.max(2, Math.min(50, Math.floor(bins)));
  let error = 0;

  for (let index = 0; index < safeBins; index++) {
    const low = index / safeBins;
    const high = (index + 1) / safeBins;
    const bucket = cases.filter((item) => {
      const p = clamp01(item.probability);
      return index === safeBins - 1 ? p >= low && p <= high : p >= low && p < high;
    });
    if (bucket.length === 0) continue;

    const meanPrediction = bucket.reduce((sum, item) => sum + clamp01(item.probability), 0) / bucket.length;
    const observedFrequency = bucket.reduce((sum, item) => sum + item.outcome, 0) / bucket.length;
    error += (bucket.length / cases.length) * Math.abs(meanPrediction - observedFrequency);
  }

  return clamp01(error);
}

export function compareBenchmarkScores(
  baseline: IntelligenceBenchmarkScore,
  candidate: IntelligenceBenchmarkScore,
) {
  return {
    compositeDelta: nullableDelta(candidate.composite, baseline.composite),
    brierImprovement: nullableDelta(baseline.brierScore, candidate.brierScore),
    calibrationImprovement: nullableDelta(baseline.calibrationError, candidate.calibrationError),
    unsupportedClaimImprovement: nullableDelta(baseline.unsupportedClaimRate, candidate.unsupportedClaimRate),
    attributionPrecisionDelta: nullableDelta(candidate.attributionPrecision, baseline.attributionPrecision),
    leadTimeDeltaHours: nullableDelta(candidate.medianLeadTimeHours, baseline.medianLeadTimeHours),
    falseWarningImprovement: nullableDelta(baseline.falseWarningRate, candidate.falseWarningRate),
    causalAccuracyDelta: nullableDelta(candidate.causalAccuracy, baseline.causalAccuracy),
    decisionUtilityDelta: nullableDelta(candidate.decisionUtility, baseline.decisionUtility),
  };
}

function median(values: number[]): number {
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[midpoint - 1] + values[midpoint]) / 2
    : values[midpoint];
}

function finiteUnit(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : null;
}

function nullableDelta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
