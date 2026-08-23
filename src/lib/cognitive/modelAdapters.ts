import type { CognitiveModality, CognitiveTask, ModelFamily } from "./modelRouter";
import type { ModelExecutionOutput } from "./modelExecution";

export interface SpecialistInferenceRequest {
  modelId: string;
  family: ModelFamily;
  modality: CognitiveModality;
  task: CognitiveTask;
  input: unknown;
  inputHash: string;
  timeoutMs: number;
  highConsequence: boolean;
  context?: Record<string, unknown>;
}

export interface SpecialistModelAdapter {
  readonly adapterKey: string;
  readonly families: ModelFamily[];
  readonly modalities: CognitiveModality[];
  readonly tasks: CognitiveTask[];
  canHandle(request: SpecialistInferenceRequest): boolean;
  infer(request: SpecialistInferenceRequest, signal?: AbortSignal): Promise<ModelExecutionOutput>;
}

/**
 * Runtime adapter registry. It intentionally contains no default external
 * providers: a model becomes executable only when a concrete, reviewed adapter
 * is registered by the host application.
 */
export class SpecialistAdapterRegistry {
  private readonly adapters = new Map<string, SpecialistModelAdapter>();

  register(adapter: SpecialistModelAdapter): void {
    if (this.adapters.has(adapter.adapterKey)) {
      throw new Error(`specialist adapter already registered: ${adapter.adapterKey}`);
    }
    this.adapters.set(adapter.adapterKey, adapter);
  }

  unregister(adapterKey: string): boolean {
    return this.adapters.delete(adapterKey);
  }

  resolve(request: SpecialistInferenceRequest): SpecialistModelAdapter | null {
    const compatible = [...this.adapters.values()].filter((adapter) => adapter.canHandle(request));
    if (compatible.length === 0) return null;
    if (compatible.length > 1) {
      throw new Error(
        `ambiguous specialist adapter resolution for ${request.family}/${request.modality}/${request.task}`,
      );
    }
    return compatible[0];
  }

  list(): Array<{
    adapterKey: string;
    families: ModelFamily[];
    modalities: CognitiveModality[];
    tasks: CognitiveTask[];
  }> {
    return [...this.adapters.values()].map((adapter) => ({
      adapterKey: adapter.adapterKey,
      families: [...adapter.families],
      modalities: [...adapter.modalities],
      tasks: [...adapter.tasks],
    }));
  }
}

export function createCapabilityAdapterGuard(
  families: ModelFamily[],
  modalities: CognitiveModality[],
  tasks: CognitiveTask[],
): (request: SpecialistInferenceRequest) => boolean {
  return (request) =>
    families.includes(request.family) &&
    modalities.includes(request.modality) &&
    tasks.includes(request.task);
}

export async function runWithTimeout(
  adapter: SpecialistModelAdapter,
  request: SpecialistInferenceRequest,
): Promise<ModelExecutionOutput> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, request.timeoutMs));
  try {
    const output = await adapter.infer(request, controller.signal);
    if (output.modelId !== request.modelId) {
      throw new Error(`adapter returned output for unexpected model ${output.modelId}`);
    }
    return output;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
