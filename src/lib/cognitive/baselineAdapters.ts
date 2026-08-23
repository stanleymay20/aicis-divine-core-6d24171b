import {
  runDriftBaseline,
  runLogisticBaseline,
  runPersistenceBaseline,
  type TabularLogisticInput,
  type TemporalSeriesInput,
} from "./baselineModels";
import type {
  SpecialistInferenceRequest,
  SpecialistModelAdapter,
} from "./modelAdapters";
import type { ModelExecutionOutput } from "./modelExecution";
import type { CognitiveModality, CognitiveTask, ModelFamily } from "./modelRouter";

export type BaselineKind = "logistic" | "persistence" | "drift";

export class DeterministicBaselineAdapter implements SpecialistModelAdapter {
  readonly adapterKey = "deterministic-baseline-v1";
  readonly families: ModelFamily[] = ["linear"];
  readonly modalities: CognitiveModality[] = ["tabular", "sequence"];
  readonly tasks: CognitiveTask[] = ["classification", "forecasting"];

  canHandle(request: SpecialistInferenceRequest): boolean {
    if (request.family !== "linear") return false;
    const kind = readBaselineKind(request.context);
    if (!kind) return false;
    if (kind === "logistic") {
      return request.modality === "tabular" && request.task === "classification";
    }
    return request.modality === "sequence" && request.task === "forecasting";
  }

  async infer(
    request: SpecialistInferenceRequest,
    signal?: AbortSignal,
  ): Promise<ModelExecutionOutput> {
    if (signal?.aborted) throw new DOMException("baseline inference aborted", "AbortError");
    const startedAt = performance.now();
    const kind = readBaselineKind(request.context);
    if (!kind) throw new Error("baseline_kind is required in request context");

    let output: ModelExecutionOutput;
    switch (kind) {
      case "logistic":
        output = runLogisticBaseline(request.modelId, parseLogisticInput(request.input));
        break;
      case "persistence":
        output = runPersistenceBaseline(request.modelId, parseTemporalInput(request.input));
        break;
      case "drift":
        output = runDriftBaseline(request.modelId, parseTemporalInput(request.input));
        break;
    }

    return {
      ...output,
      latencyMs: Math.max(0, performance.now() - startedAt),
      metadata: {
        ...(output.metadata ?? {}),
        adapterKey: this.adapterKey,
        inputHash: request.inputHash,
      },
    };
  }
}

function readBaselineKind(context: Record<string, unknown> | undefined): BaselineKind | null {
  const value = context?.baseline_kind;
  return value === "logistic" || value === "persistence" || value === "drift" ? value : null;
}

function parseLogisticInput(input: unknown): TabularLogisticInput {
  if (!isRecord(input) || !isNumberRecord(input.features) || !isNumberRecord(input.coefficients)) {
    throw new Error("logistic baseline input requires numeric features and coefficients");
  }
  if (typeof input.intercept !== "number" || !Number.isFinite(input.intercept)) {
    throw new Error("logistic baseline input requires a finite intercept");
  }
  return {
    features: input.features,
    coefficients: input.coefficients,
    intercept: input.intercept,
  };
}

function parseTemporalInput(input: unknown): TemporalSeriesInput {
  if (!isRecord(input) || !Array.isArray(input.values)) {
    throw new Error("temporal baseline input requires a values array");
  }
  const values = input.values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (values.length !== input.values.length) {
    throw new Error("temporal baseline values must all be finite numbers");
  }
  return { values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (entry) => typeof entry === "number" && Number.isFinite(entry),
  );
}
