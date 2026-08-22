export interface ProbabilisticForecast {
  probability: number;
  outcome?: 0 | 1;
  modelName?: string;
  weight?: number;
}

export interface CalibrationBucket {
  lower: number;
  upper: number;
  count: number;
  meanPrediction: number;
  observedFrequency: number | null;
  absoluteCalibrationError: number | null;
}

export interface EnsembleResult {
  probability: number;
  disagreement: number;
  confidence: number;
}

export interface ReliabilityContext {
  sensingCoverage: number;
  sourceDiversity: number;
  extractionReliability: number;
  modelReliability: number;
  freshness: number;
}

export function brierScore(probability: number, outcome: 0 | 1): number {
  const p = clamp01(probability);
  return (p - outcome) ** 2;
}

export function meanBrierScore(forecasts: ProbabilisticForecast[]): number | null {
  const resolved = forecasts.filter(
    (forecast): forecast is ProbabilisticForecast & { outcome: 0 | 1 } =>
      forecast.outcome === 0 || forecast.outcome === 1,
  );
  if (resolved.length === 0) return null;
  return resolved.reduce((sum, f) => sum + brierScore(f.probability, f.outcome), 0) / resolved.length;
}

/**
 * Reliability diagram data. A well-calibrated system should observe outcomes at
 * approximately the same rate as its stated probability in each bucket.
 */
export function calibrationBuckets(
  forecasts: ProbabilisticForecast[],
  bucketCount = 10,
): CalibrationBucket[] {
  const count = Math.max(2, Math.floor(bucketCount));
  const buckets = Array.from({ length: count }, (_, index) => ({
    lower: index / count,
    upper: (index + 1) / count,
    forecasts: [] as ProbabilisticForecast[],
  }));

  for (const forecast of forecasts) {
    const p = clamp01(forecast.probability);
    const index = Math.min(count - 1, Math.floor(p * count));
    buckets[index].forecasts.push({ ...forecast, probability: p });
  }

  return buckets.map(({ lower, upper, forecasts: entries }) => {
    if (entries.length === 0) {
      return {
        lower,
        upper,
        count: 0,
        meanPrediction: (lower + upper) / 2,
        observedFrequency: null,
        absoluteCalibrationError: null,
      };
    }

    const meanPrediction = entries.reduce((sum, entry) => sum + entry.probability, 0) / entries.length;
    const resolved = entries.filter(
      (entry): entry is ProbabilisticForecast & { outcome: 0 | 1 } =>
        entry.outcome === 0 || entry.outcome === 1,
    );
    const observedFrequency = resolved.length === 0
      ? null
      : resolved.reduce((sum, entry) => sum + entry.outcome, 0) / resolved.length;

    return {
      lower,
      upper,
      count: entries.length,
      meanPrediction,
      observedFrequency,
      absoluteCalibrationError:
        observedFrequency === null ? null : Math.abs(meanPrediction - observedFrequency),
    };
  });
}

export function expectedCalibrationError(
  forecasts: ProbabilisticForecast[],
  bucketCount = 10,
): number | null {
  const buckets = calibrationBuckets(forecasts, bucketCount);
  const resolvedCount = forecasts.filter((f) => f.outcome === 0 || f.outcome === 1).length;
  if (resolvedCount === 0) return null;

  return buckets.reduce((sum, bucket) => {
    if (bucket.absoluteCalibrationError === null) return sum;
    return sum + (bucket.count / forecasts.length) * bucket.absoluteCalibrationError;
  }, 0);
}

/**
 * Combines independently evaluated model judgments while preserving disagreement.
 * Disagreement is useful evidence: high disagreement lowers confidence rather than
 * being hidden behind an average.
 */
export function ensembleForecast(forecasts: ProbabilisticForecast[]): EnsembleResult | null {
  if (forecasts.length === 0) return null;

  const weighted = forecasts.map((forecast) => ({
    probability: clamp01(forecast.probability),
    weight: Math.max(0, forecast.weight ?? 1),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  const probability = weighted.reduce(
    (sum, item) => sum + item.probability * item.weight,
    0,
  ) / totalWeight;

  const variance = weighted.reduce(
    (sum, item) => sum + item.weight * (item.probability - probability) ** 2,
    0,
  ) / totalWeight;
  const disagreement = Math.sqrt(variance);

  return {
    probability,
    disagreement,
    confidence: clamp01(1 - 2 * disagreement),
  };
}

/**
 * Operational uncertainty is part of epistemic uncertainty. If sensing coverage,
 * freshness or extraction reliability degrade, downstream confidence must fall.
 * Geometric aggregation prevents one very weak link from being hidden by strong
 * scores elsewhere.
 */
export function operationalReliability(context: ReliabilityContext): number {
  const factors = [
    context.sensingCoverage,
    context.sourceDiversity,
    context.extractionReliability,
    context.modelReliability,
    context.freshness,
  ].map((value) => Math.max(0.0001, clamp01(value)));

  const product = factors.reduce((value, factor) => value * factor, 1);
  return clamp01(product ** (1 / factors.length));
}

export function reliabilityAdjustedConfidence(
  modelConfidence: number,
  context: ReliabilityContext,
): number {
  return clamp01(clamp01(modelConfidence) * operationalReliability(context));
}

export function modelDisagreement(forecasts: ProbabilisticForecast[]): number {
  const ensemble = ensembleForecast(forecasts);
  return ensemble?.disagreement ?? 0;
}

export function shouldEscalateForEvidence(
  forecasts: ProbabilisticForecast[],
  reliability: ReliabilityContext,
  disagreementThreshold = 0.2,
  reliabilityThreshold = 0.65,
): boolean {
  return (
    modelDisagreement(forecasts) >= disagreementThreshold ||
    operationalReliability(reliability) < reliabilityThreshold
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
