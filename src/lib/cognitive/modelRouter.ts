import { hasUsableNumericSemantics } from "./contracts";

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

const ROUTING_SCORE_SEMANTICS =
  "deterministic_model_selection_priority_score_v2_not_probability_or_confidence";

export interface SpecialistModel {
  id: string;
  family: ModelFamily;
  version: string;
  modalities: CognitiveModality[];
  tasks: CognitiveTask[];
  enabled: boolean;
  productionApproved: boolean;
  sampleSize: number;
  competence: number | null;
  competenceSemantics?: string;
  calibration: number | null;
  calibrationSemantics?: string;
  reliability: number | null;
  reliabilitySemantics?: string;
  latencyMsP95: number | null;
  latencySemantics?: string;
  costPer1k?: number | null;
  costSemantics?: string;
  freshness?: number | null;
  freshnessSemantics?: string;
  evaluationStatus?: string;
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
  scoreSemantics: string;
  evidenceStatus: "complete_measured_routing_inputs";
  reasons: string[];
}

/**
 * Deterministic competency router. Routing is withheld unless the quality metrics
 * needed by the policy are explicit, finite and semantically usable. Unknown cost
 * never becomes free, unknown latency never becomes zero, and unknown freshness
 * never becomes perfect freshness.
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
    if (!Number.isInteger(model.sampleSize) || model.sampleSize < minimumSampleSize) return false;
    if (!hasMeasuredRoutingMetrics(model)) return false;

    if (request.maxLatencyMs !== undefined) {
      if (!isFiniteNonNegative(model.latencyMsP95)) return false;
      if (model.latencyMsP95 > request.maxLatencyMs) return false;
    }

    if (request.maxCostPer1k !== undefined) {
      if (!isFiniteNonNegative(model.costPer1k) || !hasUsableNumericSemantics(model.costSemantics)) {
        return false;
      }
      if (model.costPer1k > request.maxCostPer1k) return false;
    }
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
  if (!hasMeasuredRoutingMetrics(model)) {
    throw new Error("scoreModel called with incomplete routing metrics");
  }

  const competence = model.competence as number;
  const calibration = model.calibration as number;
  const reliability = model.reliability as number;
  const latencyMsP95 = model.latencyMsP95 as number;
  const evidence = clamp01(Math.log10(Math.max(10, model.sampleSize)) / 4);
  const latency = request.maxLatencyMs !== undefined
    ? clamp01(1 - latencyMsP95 / Math.max(1, request.maxLatencyMs))
    : clamp01(1 / (1 + latencyMsP95 / 10_000));

  const score = clamp01(
    0.34 * competence +
    0.24 * calibration +
    0.22 * reliability +
    0.12 * evidence +
    0.08 * latency,
  );

  const reasons = [
    `competence metric ${competence.toFixed(4)} (${model.competenceSemantics})`,
    `calibration metric ${calibration.toFixed(4)} (${model.calibrationSemantics})`,
    `reliability metric ${reliability.toFixed(4)} (${model.reliabilitySemantics})`,
    `${model.sampleSize} evaluated cases`,
    `p95 latency ${latencyMsP95.toFixed(1)} ms (${model.latencySemantics})`,
    "routing score is a deterministic policy heuristic, not model confidence",
  ];
  if (request.highConsequence) reasons.push("production-approved for high-consequence routing");

  return {
    model,
    score,
    scoreSemantics: ROUTING_SCORE_SEMANTICS,
    evidenceStatus: "complete_measured_routing_inputs",
    reasons,
  };
}

function hasMeasuredRoutingMetrics(model: SpecialistModel): boolean {
  return isUnitInterval(model.competence) &&
    hasUsableNumericSemantics(model.competenceSemantics) &&
    isUnitInterval(model.calibration) &&
    hasUsableNumericSemantics(model.calibrationSemantics) &&
    isUnitInterval(model.reliability) &&
    hasUsableNumericSemantics(model.reliabilitySemantics) &&
    isFiniteNonNegative(model.latencyMsP95) &&
    hasUsableNumericSemantics(model.latencySemantics) &&
    !String(model.evaluationStatus ?? "").toLowerCase().includes("legacy") &&
    !String(model.evaluationStatus ?? "").toLowerCase().includes("unknown");
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

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
