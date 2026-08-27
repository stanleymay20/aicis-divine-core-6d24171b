import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FEATURE_VERSION = "truth-floor-v2";
const SPLIT_STRATEGY = "chronological_distinct_date_60_20_20_v2";
const MODEL_TYPE = "logistic";
const MODEL_SEMANTICS = "trained_logistic_temporal_holdout_v1";
const MAX_MODEL_ROWS = 50_000;
const PAGE_SIZE = 1_000;
const MIN_TRAIN_ROWS = 200;
const MIN_VALIDATION_ROWS = 50;
const MIN_TEST_ROWS = 50;
const MAX_EPOCHS = 120;
const INITIAL_LEARNING_RATE = 0.05;
const LAMBDA_GRID = [0.001, 0.01, 0.1] as const;
const CONVERGENCE_TOLERANCE = 1e-8;
const CONVERGENCE_PATIENCE = 8;

const FEATURE_NAMES = [
  "metric_zscore_vs_90d",
  "metric_trend_7d",
  "metric_trend_30d",
  "metric_volatility_30d",
  "metric_sample_count_30d",
  "events_count_7d",
  "event_severity_effective_7d",
  "cross_domain_pressure",
  "data_density_score",
  "freshness_score",
] as const;

type FeatureName = typeof FEATURE_NAMES[number];
type Split = "train" | "val" | "test";

type ManifestRow = {
  training_row_id: string;
  country_iso3: string;
  domain: string;
  snapshot_date: string;
  dataset_split: Split;
  feature_version: string;
  feature_hash: string;
  label: number;
  feature_snapshot: Record<string, unknown>;
};

type Example = {
  rowId: string;
  split: Split;
  label: 0 | 1;
  x: number[];
};

type Standardization = {
  mean: number[];
  std: number[];
  scale: number[];
};

type LogisticModel = {
  intercept: number;
  weights: number[];
  lambda: number;
  epochs: number;
  converged: boolean;
};

type Metrics = {
  rows: number;
  positives: number;
  positive_rate: number;
  accuracy_at_0_5: number;
  brier: number;
  log_loss: number;
  auc: number | null;
  ece_10_bin: number;
  baseline_probability_from_train: number;
  baseline_brier: number;
  brier_skill_vs_train_base_rate: number | null;
};

type TrainingRunInsert = {
  id: string;
  model_version: string;
  model_type: string;
  model_semantics: string;
  horizon_days: number;
  feature_version: string;
  split_strategy: string;
  source_dataset_scope: string;
  source_dataset_version: string | null;
  status: "running";
  feature_spec: Record<string, unknown>;
  hyperparameters: Record<string, unknown>;
  created_by: string | null;
  metadata: Record<string, unknown>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function userIdFromUnknown(value: unknown): string | null {
  const record = asRecord(value);
  return typeof record.id === "string" ? record.id : null;
}

function clampProbability(value: number): number {
  return Math.max(1e-15, Math.min(1 - 1e-15, value));
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function dot(left: number[], right: number[]): number {
  let total = 0;
  for (let i = 0; i < left.length; i += 1) total += left[i] * right[i];
  return total;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function standardizationFromTrain(examples: Example[]): Standardization {
  const featureCount = FEATURE_NAMES.length;
  const means = Array<number>(featureCount).fill(0);

  for (const example of examples) {
    for (let j = 0; j < featureCount; j += 1) means[j] += example.x[j];
  }
  for (let j = 0; j < featureCount; j += 1) means[j] /= examples.length;

  const variances = Array<number>(featureCount).fill(0);
  for (const example of examples) {
    for (let j = 0; j < featureCount; j += 1) {
      const delta = example.x[j] - means[j];
      variances[j] += delta * delta;
    }
  }

  const std = variances.map((sum) =>
    examples.length > 1 ? Math.sqrt(sum / (examples.length - 1)) : 0
  );
  const scale = std.map((value) => value > 1e-12 ? value : 1);
  return { mean: means, std, scale };
}

function standardize(x: number[], stats: Standardization): number[] {
  return x.map((value, index) => (value - stats.mean[index]) / stats.scale[index]);
}

function classCounts(examples: Example[]): { positive: number; negative: number } {
  let positive = 0;
  for (const example of examples) positive += example.label;
  return { positive, negative: examples.length - positive };
}

function aucRankBased(probabilities: number[], labels: number[]): number | null {
  const pairs = probabilities.map((probability, index) => ({
    probability,
    label: labels[index],
  })).sort((a, b) => a.probability - b.probability);

  const positive = labels.reduce((sum, label) => sum + label, 0);
  const negative = labels.length - positive;
  if (positive === 0 || negative === 0) return null;

  let positiveRankSum = 0;
  let index = 0;
  while (index < pairs.length) {
    let end = index + 1;
    while (end < pairs.length && pairs[end].probability === pairs[index].probability) end += 1;
    const averageRank = ((index + 1) + end) / 2;
    for (let k = index; k < end; k += 1) {
      if (pairs[k].label === 1) positiveRankSum += averageRank;
    }
    index = end;
  }

  return (positiveRankSum - positive * (positive + 1) / 2) / (positive * negative);
}

function ece10(probabilities: number[], labels: number[]): number {
  const binCount = 10;
  const counts = Array<number>(binCount).fill(0);
  const probabilitySums = Array<number>(binCount).fill(0);
  const labelSums = Array<number>(binCount).fill(0);

  for (let i = 0; i < probabilities.length; i += 1) {
    const p = Math.max(0, Math.min(0.999999999999, probabilities[i]));
    const bin = Math.min(binCount - 1, Math.floor(p * binCount));
    counts[bin] += 1;
    probabilitySums[bin] += p;
    labelSums[bin] += labels[i];
  }

  let ece = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    if (counts[bin] === 0) continue;
    const meanProbability = probabilitySums[bin] / counts[bin];
    const empiricalRate = labelSums[bin] / counts[bin];
    ece += (counts[bin] / probabilities.length) * Math.abs(meanProbability - empiricalRate);
  }
  return ece;
}

function predict(model: LogisticModel, standardizedX: number[]): number {
  return sigmoid(model.intercept + dot(model.weights, standardizedX));
}

function evaluate(
  model: LogisticModel,
  examples: Example[],
  stats: Standardization,
  trainBaseRate: number,
): Metrics {
  const probabilities: number[] = [];
  const labels: number[] = [];
  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  let positives = 0;
  let baselineBrier = 0;

  for (const example of examples) {
    const probability = predict(model, standardize(example.x, stats));
    const label = example.label;
    const error = probability - label;
    probabilities.push(probability);
    labels.push(label);
    positives += label;
    brier += error * error;
    const clipped = clampProbability(probability);
    logLoss += -(label * Math.log(clipped) + (1 - label) * Math.log(1 - clipped));
    const predictedClass = probability >= 0.5 ? 1 : 0;
    if (predictedClass === label) correct += 1;
    const baselineError = trainBaseRate - label;
    baselineBrier += baselineError * baselineError;
  }

  brier /= examples.length;
  logLoss /= examples.length;
  baselineBrier /= examples.length;
  const skill = baselineBrier > 0 ? 1 - brier / baselineBrier : null;

  return {
    rows: examples.length,
    positives,
    positive_rate: positives / examples.length,
    accuracy_at_0_5: correct / examples.length,
    brier,
    log_loss: logLoss,
    auc: aucRankBased(probabilities, labels),
    ece_10_bin: ece10(probabilities, labels),
    baseline_probability_from_train: trainBaseRate,
    baseline_brier: baselineBrier,
    brier_skill_vs_train_base_rate: skill,
  };
}

function trainLogistic(
  trainExamples: Example[],
  stats: Standardization,
  lambda: number,
): LogisticModel {
  const standardized = trainExamples.map((example) => ({
    x: standardize(example.x, stats),
    label: example.label,
  }));
  const trainRate = mean(trainExamples.map((example) => example.label));
  const initialRate = Math.max(1e-6, Math.min(1 - 1e-6, trainRate));
  let intercept = Math.log(initialRate / (1 - initialRate));
  const weights = Array<number>(FEATURE_NAMES.length).fill(0);
  let previousLoss = Number.POSITIVE_INFINITY;
  let stableEpochs = 0;
  let epochs = 0;
  let converged = false;

  for (let epoch = 0; epoch < MAX_EPOCHS; epoch += 1) {
    const gradWeights = Array<number>(weights.length).fill(0);
    let gradIntercept = 0;
    let negativeLogLikelihood = 0;

    for (const example of standardized) {
      const probability = predict(
        { intercept, weights, lambda, epochs: epoch, converged: false },
        example.x,
      );
      const error = probability - example.label;
      gradIntercept += error;
      for (let j = 0; j < weights.length; j += 1) {
        gradWeights[j] += error * example.x[j];
      }
      const clipped = clampProbability(probability);
      negativeLogLikelihood += -(
        example.label * Math.log(clipped)
        + (1 - example.label) * Math.log(1 - clipped)
      );
    }

    const n = standardized.length;
    gradIntercept /= n;
    negativeLogLikelihood /= n;
    let regularizationLoss = 0;
    for (let j = 0; j < weights.length; j += 1) {
      gradWeights[j] = gradWeights[j] / n + lambda * weights[j];
      regularizationLoss += 0.5 * lambda * weights[j] * weights[j];
    }

    const loss = negativeLogLikelihood + regularizationLoss;
    const learningRate = INITIAL_LEARNING_RATE / Math.sqrt(1 + epoch / 20);
    intercept -= learningRate * gradIntercept;
    for (let j = 0; j < weights.length; j += 1) {
      weights[j] -= learningRate * gradWeights[j];
    }

    const improvement = previousLoss - loss;
    if (Number.isFinite(previousLoss) && Math.abs(improvement) < CONVERGENCE_TOLERANCE) {
      stableEpochs += 1;
    } else {
      stableEpochs = 0;
    }
    previousLoss = loss;
    epochs = epoch + 1;

    if (stableEpochs >= CONVERGENCE_PATIENCE) {
      converged = true;
      break;
    }
  }

  return { intercept, weights, lambda, epochs, converged };
}

function metricsScore(metrics: Metrics): [number, number] {
  return [metrics.brier, metrics.log_loss];
}

function isBetterMetrics(candidate: Metrics, incumbent: Metrics | null): boolean {
  if (!incumbent) return true;
  const [candidateBrier, candidateLogLoss] = metricsScore(candidate);
  const [incumbentBrier, incumbentLogLoss] = metricsScore(incumbent);
  if (candidateBrier < incumbentBrier - 1e-12) return true;
  if (Math.abs(candidateBrier - incumbentBrier) <= 1e-12) {
    return candidateLogLoss < incumbentLogLoss;
  }
  return false;
}

function parseExample(row: ManifestRow): Example | null {
  const snapshot = asRecord(row.feature_snapshot);
  const values: number[] = [];
  for (const featureName of FEATURE_NAMES) {
    const value = finiteNumber(snapshot[featureName]);
    if (value === null) return null;
    values.push(value);
  }
  if (row.label !== 0 && row.label !== 1) return null;
  return {
    rowId: row.training_row_id,
    split: row.dataset_split,
    label: row.label,
    x: values,
  };
}

function featureMap(values: number[]): Record<FeatureName, number> {
  return Object.fromEntries(
    FEATURE_NAMES.map((name, index) => [name, values[index]]),
  ) as Record<FeatureName, number>;
}

async function fetchManifestRows(
  sb: ReturnType<typeof createClient>,
  runId: string,
  expectedRows: number,
): Promise<ManifestRow[]> {
  if (expectedRows > MAX_MODEL_ROWS) {
    throw new Error(
      `eligible manifest has ${expectedRows} rows, above in-function training ceiling ${MAX_MODEL_ROWS}; use a scalable external trainer rather than silently sampling`,
    );
  }

  const rows: ManifestRow[] = [];
  for (let from = 0; from < expectedRows; from += PAGE_SIZE) {
    const to = Math.min(expectedRows - 1, from + PAGE_SIZE - 1);
    const { data, error } = await sb
      .from("ml_model_training_manifest_rows")
      .select("training_row_id,country_iso3,domain,snapshot_date,dataset_split,feature_version,feature_hash,label,feature_snapshot")
      .eq("training_run_id", runId)
      .order("snapshot_date", { ascending: true })
      .order("country_iso3", { ascending: true })
      .order("domain", { ascending: true })
      .order("training_row_id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const page = (data ?? []) as unknown as ManifestRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const modelVersion = `logistic-candidate-${startedAt.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${runId.slice(0, 8)}`;

  const featureSpec: Record<string, unknown> = {
    feature_version: FEATURE_VERSION,
    features: FEATURE_NAMES,
    neighbor_risk_score: "excluded_until_verified_adjacency_exists",
    event_severity_effective_7d: {
      source: "event_severity_avg_7d",
      rule: "use observed severity when present; encode 0 only when events_count_7d is exactly 0; otherwise exclude row",
    },
    missing_core_features: "exclude_row_no_imputation",
    standardization: "mean_and_sample_std_from_train_split_only",
    probability_model: "unweighted_binary_logistic_regression",
  };

  const hyperparameters: Record<string, unknown> = {
    optimizer: "deterministic_full_batch_gradient_descent",
    max_epochs: MAX_EPOCHS,
    initial_learning_rate: INITIAL_LEARNING_RATE,
    learning_rate_schedule: "lr/sqrt(1+epoch/20)",
    l2_lambda_grid: LAMBDA_GRID,
    selection_split: "validation",
    selection_metric_primary: "brier",
    selection_metric_tiebreak: "log_loss",
    test_split_usage: "evaluate_once_after_lambda_selection",
    convergence_tolerance: CONVERGENCE_TOLERANCE,
    convergence_patience: CONVERGENCE_PATIENCE,
    max_in_function_rows: MAX_MODEL_ROWS,
  };

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const requestedHorizon = Number(body.horizon_days ?? 7);
    const horizon = [7, 30, 90].includes(requestedHorizon) ? requestedHorizon : 7;

    const { data: datasetVersionData, error: datasetVersionError } = await sb
      .from("training_dataset_versions")
      .select("dataset_version,version_scope,split_strategy,checksum,created_at")
      .eq("horizon_days", horizon)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (datasetVersionError) throw datasetVersionError;

    const sourceDatasetVersion = typeof datasetVersionData?.dataset_version === "string"
      ? datasetVersionData.dataset_version
      : null;

    const runInsert: TrainingRunInsert = {
      id: runId,
      model_version: modelVersion,
      model_type: MODEL_TYPE,
      model_semantics: MODEL_SEMANTICS,
      horizon_days: horizon,
      feature_version: FEATURE_VERSION,
      split_strategy: SPLIT_STRATEGY,
      source_dataset_scope: "mutable_corpus_snapshotted_atomically_into_immutable_training_manifest_v1",
      source_dataset_version: sourceDatasetVersion,
      status: "running",
      feature_spec: featureSpec,
      hyperparameters,
      created_by: auth.via === "admin" ? userIdFromUnknown(auth.user) : null,
      metadata: {
        invoked_via: auth.via,
        source_version_is_informational_delta: true,
        source_version_scope: datasetVersionData?.version_scope ?? null,
        source_version_checksum: datasetVersionData?.checksum ?? null,
      },
    };

    const { error: runInsertError } = await sb
      .from("ml_model_training_runs")
      .insert(runInsert);
    if (runInsertError) throw runInsertError;

    const { data: manifestData, error: manifestError } = await sb.rpc(
      "prepare_ml_training_manifest",
      {
        p_training_run_id: runId,
        p_horizon_days: horizon,
        p_feature_version: FEATURE_VERSION,
        p_split_strategy: SPLIT_STRATEGY,
      },
    );
    if (manifestError) throw manifestError;

    const manifest = asRecord(manifestData);
    const eligibleRows = Number(manifest.eligible_rows ?? 0);
    const trainRows = Number(manifest.train_rows ?? 0);
    const validationRows = Number(manifest.validation_rows ?? 0);
    const testRows = Number(manifest.test_rows ?? 0);

    const abstentionReasons: string[] = [];
    if (!Number.isFinite(eligibleRows) || eligibleRows <= 0) abstentionReasons.push("no_eligible_truth_floor_rows");
    if (eligibleRows > MAX_MODEL_ROWS) abstentionReasons.push("dataset_exceeds_in_function_training_ceiling");
    if (trainRows < MIN_TRAIN_ROWS) abstentionReasons.push(`train_rows_below_${MIN_TRAIN_ROWS}`);
    if (validationRows < MIN_VALIDATION_ROWS) abstentionReasons.push(`validation_rows_below_${MIN_VALIDATION_ROWS}`);
    if (testRows < MIN_TEST_ROWS) abstentionReasons.push(`test_rows_below_${MIN_TEST_ROWS}`);

    if (abstentionReasons.length > 0) {
      await sb.from("ml_model_training_runs").update({
        status: "abstained",
        completed_at: new Date().toISOString(),
        failure_reason: abstentionReasons.join(","),
        metadata: {
          ...asRecord(runInsert.metadata),
          manifest,
          abstention_reasons: abstentionReasons,
        },
      }).eq("id", runId);

      return json({
        ok: true,
        trained: false,
        status: "abstained",
        model_version: modelVersion,
        training_run_id: runId,
        reasons: abstentionReasons,
        manifest,
      }, 422);
    }

    const manifestRows = await fetchManifestRows(sb, runId, eligibleRows);
    if (manifestRows.length !== eligibleRows) {
      throw new Error(`manifest fetch mismatch: expected ${eligibleRows}, read ${manifestRows.length}`);
    }

    const examples = manifestRows.map(parseExample).filter((value): value is Example => value !== null);
    if (examples.length !== manifestRows.length) {
      throw new Error("immutable manifest contained a non-finite or malformed feature after snapshot preparation");
    }

    const train = examples.filter((example) => example.split === "train");
    const validation = examples.filter((example) => example.split === "val");
    const test = examples.filter((example) => example.split === "test");

    const trainClasses = classCounts(train);
    const validationClasses = classCounts(validation);
    const testClasses = classCounts(test);
    const classFailure: string[] = [];
    if (trainClasses.positive === 0 || trainClasses.negative === 0) classFailure.push("train_split_single_class");
    if (validationClasses.positive === 0 || validationClasses.negative === 0) classFailure.push("validation_split_single_class");
    if (testClasses.positive === 0 || testClasses.negative === 0) classFailure.push("test_split_single_class");

    if (classFailure.length > 0) {
      await sb.from("ml_model_training_runs").update({
        status: "abstained",
        completed_at: new Date().toISOString(),
        failure_reason: classFailure.join(","),
        metadata: {
          ...asRecord(runInsert.metadata),
          manifest,
          class_counts: { train: trainClasses, validation: validationClasses, test: testClasses },
          abstention_reasons: classFailure,
        },
      }).eq("id", runId);

      return json({
        ok: true,
        trained: false,
        status: "abstained",
        model_version: modelVersion,
        training_run_id: runId,
        reasons: classFailure,
      }, 422);
    }

    const stats = standardizationFromTrain(train);
    const trainBaseRate = trainClasses.positive / train.length;

    let bestModel: LogisticModel | null = null;
    let bestValidationMetrics: Metrics | null = null;
    const candidateDiagnostics: Array<Record<string, unknown>> = [];

    for (const lambda of LAMBDA_GRID) {
      const model = trainLogistic(train, stats, lambda);
      const trainMetrics = evaluate(model, train, stats, trainBaseRate);
      const validationMetrics = evaluate(model, validation, stats, trainBaseRate);
      candidateDiagnostics.push({
        lambda,
        epochs: model.epochs,
        converged: model.converged,
        train: trainMetrics,
        validation: validationMetrics,
      });

      if (isBetterMetrics(validationMetrics, bestValidationMetrics)) {
        bestModel = model;
        bestValidationMetrics = validationMetrics;
      }
    }

    if (!bestModel || !bestValidationMetrics) throw new Error("no candidate model was produced");

    // Test data is touched only after the validation-selected lambda is fixed.
    const testMetrics = evaluate(bestModel, test, stats, trainBaseRate);
    const trainMetrics = evaluate(bestModel, train, stats, trainBaseRate);

    const reviewSignals = {
      validation_brier_skill_positive:
        bestValidationMetrics.brier_skill_vs_train_base_rate !== null
        && bestValidationMetrics.brier_skill_vs_train_base_rate > 0,
      test_brier_skill_positive:
        testMetrics.brier_skill_vs_train_base_rate !== null
        && testMetrics.brier_skill_vs_train_base_rate > 0,
      validation_auc_defined: bestValidationMetrics.auc !== null,
      test_auc_defined: testMetrics.auc !== null,
      no_auto_promotion: true,
    };
    const eligibleForManualReview = Object.entries(reviewSignals)
      .filter(([key]) => key !== "no_auto_promotion")
      .every(([, value]) => value === true);

    const standardizationRecord = Object.fromEntries(
      FEATURE_NAMES.map((name, index) => [name, {
        mean: stats.mean[index],
        sample_std: stats.std[index],
        scale_denominator: stats.scale[index],
      }]),
    );
    const weightsRecord = Object.fromEntries(
      FEATURE_NAMES.map((name, index) => [name, bestModel.weights[index]]),
    );

    const completedAt = new Date().toISOString();
    const { error: weightInsertError } = await sb.from("ml_model_weights").insert({
      model_version: modelVersion,
      model_type: MODEL_TYPE,
      weights: {
        intercept: bestModel.intercept,
        coefficients: weightsRecord,
        coefficient_space: "standardized_features",
      },
      trained_at: completedAt,
      training_rows: train.length,
      validation_auc: bestValidationMetrics.auc,
      active: false,
      model_semantics: MODEL_SEMANTICS,
      training_dataset_version: sourceDatasetVersion,
      validation_brier: bestValidationMetrics.brier,
      validation_log_loss: bestValidationMetrics.log_loss,
      validation_ece: bestValidationMetrics.ece_10_bin,
      promotion_status: "candidate",
      promoted_at: null,
      promotion_notes: {
        eligible_for_manual_review: eligibleForManualReview,
        review_signals: reviewSignals,
        warning: "Candidate is not active and must not be promoted without explicit review of temporal validation/test evidence and operational fit.",
      },
      training_run_id: runId,
      feature_spec: featureSpec,
      standardization: standardizationRecord,
      validation_metrics: bestValidationMetrics,
      test_metrics: testMetrics,
    });
    if (weightInsertError) throw weightInsertError;

    const { error: runUpdateError } = await sb.from("ml_model_training_runs").update({
      status: "completed",
      completed_at: completedAt,
      standardization: standardizationRecord,
      train_positive_rate: trainBaseRate,
      validation_metrics: bestValidationMetrics,
      test_metrics: testMetrics,
      base_rate_reference: {
        probability: trainBaseRate,
        semantics: "constant_train_split_positive_rate_applied_unchanged_to_validation_and_test",
        validation_brier: bestValidationMetrics.baseline_brier,
        test_brier: testMetrics.baseline_brier,
      },
      hyperparameters: {
        ...hyperparameters,
        selected_l2_lambda: bestModel.lambda,
        selected_epochs: bestModel.epochs,
        converged: bestModel.converged,
      },
      metadata: {
        ...asRecord(runInsert.metadata),
        manifest,
        class_counts: { train: trainClasses, validation: validationClasses, test: testClasses },
        candidate_diagnostics: candidateDiagnostics,
        train_metrics_selected_model: trainMetrics,
        review_signals: reviewSignals,
        eligible_for_manual_review: eligibleForManualReview,
        duration_ms: Date.now() - startedAt.getTime(),
      },
    }).eq("id", runId);
    if (runUpdateError) throw runUpdateError;

    console.log(JSON.stringify({
      level: "info",
      function: "train-risk-model-candidate",
      message: "candidate_training_completed",
      model_version: modelVersion,
      training_run_id: runId,
      rows: examples.length,
      selected_lambda: bestModel.lambda,
      validation_brier: bestValidationMetrics.brier,
      test_brier: testMetrics.brier,
      eligible_for_manual_review: eligibleForManualReview,
      timestamp: completedAt,
    }));

    return json({
      ok: true,
      trained: true,
      activated: false,
      promotion_status: "candidate",
      eligible_for_manual_review: eligibleForManualReview,
      model_version: modelVersion,
      training_run_id: runId,
      feature_names: FEATURE_NAMES,
      selected_lambda: bestModel.lambda,
      epochs: bestModel.epochs,
      converged: bestModel.converged,
      rows: {
        train: train.length,
        validation: validation.length,
        test: test.length,
      },
      validation_metrics: bestValidationMetrics,
      test_metrics: testMetrics,
      base_rate_probability: trainBaseRate,
      note: "No model activation occurred. Promotion requires a separate explicit review step.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      level: "error",
      function: "train-risk-model-candidate",
      message,
      model_version: modelVersion,
      training_run_id: runId,
      timestamp: new Date().toISOString(),
    }));

    // Best-effort failure ledger. If the initial run insert itself failed this
    // update safely affects zero rows.
    await sb.from("ml_model_training_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      failure_reason: message,
      metadata: {
        failure_stage: "candidate_training",
        duration_ms: Date.now() - startedAt.getTime(),
      },
    }).eq("id", runId);

    return json({
      ok: false,
      trained: false,
      model_version: modelVersion,
      training_run_id: runId,
      error: "Candidate model training failed",
      detail: message,
    }, 500);
  }
});
