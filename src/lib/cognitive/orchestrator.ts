import type { CognitiveEvent } from "./contracts";
import { hasQuantifiedUnitInterval } from "./contracts";
import type { PlanetaryGraph } from "./graph";
import { systemicPriority } from "./graph";
import type { ProbabilisticForecast, ReliabilityContext } from "./learning";
import { operationalReliability, shouldEscalateForEvidence } from "./learning";

export type CognitiveRoute =
  | "archive"
  | "lightweight-analysis"
  | "deep-investigation"
  | "simulation"
  | "human-escalation";

export interface OrchestrationContext {
  graph?: PlanetaryGraph;
  anomalyScore?: number;
  noveltyScore?: number;
  severity?: number;
  forecasts?: ProbabilisticForecast[];
  reliability?: ReliabilityContext;
  affectedDomains?: number;
  contradictionCount?: number;
  verifiedEvidenceCount?: number;
}

export interface OrchestrationDecision {
  route: CognitiveRoute;
  priority: number | null;
  prioritySemantics: string;
  evidenceStatus: "complete" | "partial" | "withheld";
  reasons: string[];
  requiredCapabilities: Array<
    | "retrieval"
    | "evidence-check"
    | "graph-analysis"
    | "causal-analysis"
    | "forecasting"
    | "simulation"
    | "skeptic-agent"
    | "human-review"
  >;
}

const PRIORITY_SEMANTICS = "deterministic_operator_routing_priority_from_available_explicit_inputs_not_probability";

/**
 * Deterministic routing policy. Missing scores remain missing and the policy
 * reweights only explicitly available inputs; it never turns absence into zero,
 * a neutral midpoint, or perfect reliability.
 */
export function routeCognitiveEvent(
  event: CognitiveEvent,
  context: OrchestrationContext = {},
): OrchestrationDecision {
  const reasons: string[] = [];
  const capabilities = new Set<OrchestrationDecision["requiredCapabilities"][number]>();

  const severity = unitOrNull(context.severity) ?? severityFromEvent(event);
  const anomaly = unitOrNull(context.anomalyScore);
  const novelty = unitOrNull(context.noveltyScore);
  const domains = nonNegativeFiniteOrNull(context.affectedDomains);
  const contradictions = nonNegativeFiniteOrNull(context.contradictionCount);
  const verifiedEvidence = nonNegativeFiniteOrNull(context.verifiedEvidenceCount);
  const eventConfidence = hasQuantifiedUnitInterval(event.confidence, event.confidenceSemantics)
    ? event.confidence
    : null;

  let priority = weightedKnownAverage([
    { value: severity, weight: 0.28 },
    { value: anomaly, weight: 0.22 },
    { value: novelty, weight: 0.16 },
    { value: eventConfidence, weight: 0.18 },
    { value: domains === null ? null : clamp01(domains / 6), weight: 0.16 },
  ]);

  if (context.graph && event.subjectEntityId) {
    capabilities.add("graph-analysis");
    if (anomaly !== null && novelty !== null && severity !== null) {
      const graphPriority = systemicPriority(
        context.graph,
        event.subjectEntityId,
        anomaly,
        novelty,
        severity,
      );
      if (graphPriority.score !== null) {
        priority = priority === null
          ? graphPriority.score
          : clamp01(0.55 * priority + 0.45 * graphPriority.score);
        if (graphPriority.score >= 0.7) reasons.push("Event touches a systemically important graph node");
      } else {
        reasons.push("Graph-weighted priority withheld because graph quantification is incomplete");
      }
    } else {
      reasons.push("Graph-weighted priority withheld because anomaly, novelty or severity is unquantified");
    }
  }

  if (event.epistemicStatus === "unverified") {
    capabilities.add("retrieval");
    capabilities.add("evidence-check");
    reasons.push("Event is not yet verified");
  }

  if (event.epistemicStatus === "contradicted" || (contradictions !== null && contradictions > 0)) {
    capabilities.add("evidence-check");
    capabilities.add("skeptic-agent");
    reasons.push("Material contradictory evidence requires explicit investigation");
    if (priority !== null) priority = clamp01(priority + 0.08);
  }

  if (anomaly !== null && anomaly >= 0.75) {
    capabilities.add("graph-analysis");
    capabilities.add("forecasting");
    reasons.push("Strong measured anomaly score");
  }

  if (novelty !== null && novelty >= 0.75) {
    capabilities.add("retrieval");
    capabilities.add("skeptic-agent");
    reasons.push("Measured configuration novelty is high");
  }

  if (domains !== null && domains >= 3) {
    capabilities.add("causal-analysis");
    reasons.push(`Cross-domain reach spans ${domains} domains`);
  }

  const reliabilityAssessment = context.reliability
    ? operationalReliability(context.reliability)
    : null;
  const reliability = reliabilityAssessment?.score ?? null;

  if (context.forecasts && context.reliability) {
    const escalation = shouldEscalateForEvidence(context.forecasts, context.reliability);
    if (escalation.escalate) {
      capabilities.add("evidence-check");
      capabilities.add("skeptic-agent");
      reasons.push(...escalation.reasons);
    }
  }

  if (reliability === null) {
    capabilities.add("evidence-check");
    reasons.push("Operational reliability is not fully measurable; autonomous simulation is withheld");
  } else if (reliability < 0.6) {
    reasons.push("Measured operational reliability heuristic is degraded");
    if (priority !== null) priority = clamp01(priority * 0.9 + 0.05);
  }

  if (verifiedEvidence !== null && verifiedEvidence >= 3 && priority !== null && priority >= 0.65) {
    capabilities.add("causal-analysis");
    capabilities.add("forecasting");
  }

  const highConsequenceEvent =
    event.eventType === "cascade.detected" ||
    event.eventType === "feedback_loop.detected" ||
    event.eventType === "decision.proposed" ||
    event.eventType === "action.executed";

  if (highConsequenceEvent) {
    if (priority !== null) priority = clamp01(priority + 0.12);
    capabilities.add("human-review");
    reasons.push("High-consequence cognitive event type");
  }

  let route: CognitiveRoute;
  if (priority === null) {
    route = "human-escalation";
    capabilities.add("human-review");
    capabilities.add("evidence-check");
    reasons.push("Routing priority withheld because no usable quantitative routing inputs were available");
  } else if (priority < 0.2 && event.epistemicStatus !== "contradicted") {
    route = "archive";
  } else if (priority < 0.45) {
    route = "lightweight-analysis";
  } else if (priority < 0.72) {
    route = "deep-investigation";
    capabilities.add("retrieval");
    capabilities.add("evidence-check");
  } else if (
    priority < 0.9 &&
    reliability !== null &&
    reliability >= 0.6 &&
    event.epistemicStatus !== "unverified" &&
    event.epistemicStatus !== "contradicted"
  ) {
    route = "simulation";
    capabilities.add("causal-analysis");
    capabilities.add("forecasting");
    capabilities.add("simulation");
  } else {
    route = "human-escalation";
    capabilities.add("human-review");
  }

  if (event.epistemicStatus === "unverified" && route === "simulation") {
    route = "deep-investigation";
  }

  const missingCoreInputs = [severity, anomaly, novelty, eventConfidence, domains]
    .filter((value) => value === null).length;

  return {
    route,
    priority,
    prioritySemantics: PRIORITY_SEMANTICS,
    evidenceStatus: priority === null ? "withheld" : missingCoreInputs > 0 ? "partial" : "complete",
    reasons: reasons.length > 0 ? reasons : ["Routing derived from explicit available evidence"],
    requiredCapabilities: [...capabilities],
  };
}

function severityFromEvent(event: CognitiveEvent): number | null {
  const payloadSeverity = event.payload?.severity;
  if (typeof payloadSeverity === "number") return unitOrNull(payloadSeverity);
  if (typeof payloadSeverity !== "string") return null;

  switch (payloadSeverity.toLowerCase()) {
    case "emergency": return 1;
    case "critical": return 0.9;
    case "high": return 0.75;
    case "medium": return 0.5;
    case "low": return 0.25;
    default: return null;
  }
}

function weightedKnownAverage(
  inputs: Array<{ value: number | null; weight: number }>,
): number | null {
  const usable = inputs.filter((input): input is { value: number; weight: number } =>
    input.value !== null && Number.isFinite(input.weight) && input.weight > 0
  );
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, input) => sum + input.weight, 0);
  return clamp01(usable.reduce((sum, input) => sum + input.value * input.weight, 0) / totalWeight);
}

function unitOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function nonNegativeFiniteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
