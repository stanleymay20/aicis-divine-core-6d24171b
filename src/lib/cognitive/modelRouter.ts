export type ModelFamily =
  | "linear"
  | "tree"
  | "ann"
  | "cnn"
  | "rnn"
  | "lstm"
  | "temporal-transformer"
  | "gnn"
  | "vision-transformer"
  | "llm"
  | "multimodal";

export type CognitiveModality =
  | "tabular"
  | "image"
  | "geospatial"
  | "sequence"
  | "graph"
  | "language"
  | "multimodal";

export type CognitiveTask =
  | "classification"
  | "regression"
  | "forecasting"
  | "anomaly-detection"
  | "object-detection"
  | "segmentation"
  | "relationship-prediction"
  | "retrieval"
  | "synthesis"
  | "hypothesis-generation"
  | "causal-analysis";

export interface SpecialistModel {
  id: string;
  family: ModelFamily;
  version: string;
  modalities: CognitiveModality[];
  tasks: CognitiveTask[];
  enabled: boolean;
  productionApproved: boolean;
  sampleSize: number;
  competence: number;
  calibration: number;
  reliability: number;
  latencyMsP95: number;
  costPer1k?: number;
  freshness?: number;
}

export interface ModelRoutingRequest {
  modality: CognitiveModality;
  task: CognitiveTask;
  highConsequence?: boolean;
  maxLatencyMs?: number;
  maxCostPer1k?: number;
  minimumSampleSize?: number;
  preferDiversity?: boolean;
  ensembleSize?: number;
}

export interface RoutedModel {
  model: SpecialistModel;
  score: number;
  reasons: string[];
}

/**
 * Deterministic competency router. A model is selected because it has measured
 * fitness for a task, not because it is fashionable or because an LLM selected
 * itself. High-consequence work requires production approval and stronger
 * empirical history.
 */
export function routeSpecialistModels(
  models: SpecialistModel[],
  request: ModelRoutingRequest,
): RoutedModel[] {
  const minimumSampleSize = Math.max(
    request.highConsequence ? 100 : 20,
    request.minimumSampleSize ?? 0,
  );

  const eligible = models.filter((model) => {
    if (!model.enabled) return false;
    if (request.highConsequence && !model.productionApproved) return false;
    if (!model.modalities.includes(request.modality)) return false;
    if (!model.tasks.includes(request.task)) return false;
    if (model.sampleSize < minimumSampleSize) return false;
    if (request.maxLatencyMs && model.latencyMsP95 > request.maxLatencyMs) return false;
    if (request.maxCostPer1k !== undefined && (model.costPer1k ?? 0) > request.maxCostPer1k) return false;
    return true;
  });

  const ranked = eligible
    .map((model) => scoreModel(model, request))
    .sort((a, b) => b.score - a.score);

  const desired = Math.max(1, Math.min(request.ensembleSize ?? 1, 5));
  if (!request.preferDiversity || desired === 1) return ranked.slice(0, desired);

  const selected: RoutedModel[] = [];
  const usedFamilies = new Set<ModelFamily>();
  for (const candidate of ranked) {
    if (selected.length >= desired) break;
    if (!usedFamilies.has(candidate.model.family)) {
      selected.push(candidate);
      usedFamilies.add(candidate.model.family);
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= desired) break;
    if (!selected.some((entry) => entry.model.id === candidate.model.id)) selected.push(candidate);
  }
  return selected;
}

function scoreModel(model: SpecialistModel, request: ModelRoutingRequest): RoutedModel {
  const competence = clamp01(model.competence);
  const calibration = clamp01(model.calibration);
  const reliability = clamp01(model.reliability);
  const freshness = clamp01(model.freshness ?? 1);
  const evidence = clamp01(Math.log10(Math.max(10, model.sampleSize)) / 4);
  const latency = request.maxLatencyMs
    ? clamp01(1 - model.latencyMsP95 / Math.max(1, request.maxLatencyMs))
    : clamp01(1 / (1 + model.latencyMsP95 / 10_000));

  const score = clamp01(
    0.32 * competence +
      0.23 * calibration +
      0.2 * reliability +
      0.1 * evidence +
      0.08 * freshness +
      0.07 * latency,
  );

  const reasons = [
    `competence ${(competence * 100).toFixed(0)}%`,
    `calibration ${(calibration * 100).toFixed(0)}%`,
    `reliability ${(reliability * 100).toFixed(0)}%`,
    `${model.sampleSize} evaluated cases`,
  ];
  if (request.highConsequence) reasons.push("production-approved for high-consequence routing");
  return { model, score, reasons };
}

export function familyForModality(modality: CognitiveModality): ModelFamily[] {
  switch (modality) {
    case "image":
    case "geospatial":
      return ["cnn", "vision-transformer", "multimodal"];
    case "sequence":
      return ["lstm", "rnn", "temporal-transformer"];
    case "graph":
      return ["gnn"];
    case "tabular":
      return ["linear", "tree", "ann"];
    case "language":
      return ["llm"];
    case "multimodal":
      return ["multimodal", "llm"];
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
