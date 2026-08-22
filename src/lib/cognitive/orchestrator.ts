import type { CognitiveEvent } from "./contracts";
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
  priority: number;
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

/**
 * Deterministic routing policy for deciding where expensive cognition is justified.
 * The LLM may execute a requested capability, but it does not choose its own level
 * of authority or silently promote an event to a high-consequence workflow.
 */
export function routeCognitiveEvent(
  event: CognitiveEvent,
  context: OrchestrationContext = {},
): OrchestrationDecision {
  const reasons: string[] = [];
  const capabilities = new Set<OrchestrationDecision["requiredCapabilities"][number]>();
  const severity = clamp01(context.severity ?? severityFromEvent(event));
  const anomaly = clamp01(context.anomalyScore ?? 0);
  const novelty = clamp01(context.noveltyScore ?? 0);
  const domains = Math.max(0, context.affectedDomains ?? 0);
  const contradictions = Math.max(0, context.contradictionCount ?? 0);
  const verifiedEvidence = Math.max(0, context.verifiedEvidenceCount ?? 0);

  let priority = clamp01(
    0.28 * severity +
      0.22 * anomaly +
      0.16 * novelty +
      0.18 * clamp01(event.confidence) +
      0.16 * clamp01(domains / 6),
  );

  if (context.graph && event.subjectEntityId) {
    const graphPriority = systemicPriority(
      context.graph,
      event.subjectEntityId,
      anomaly,
      novelty,
      severity,
    );
    priority = clamp01(0.55 * priority + 0.45 * graphPriority);
    capabilities.add("graph-analysis");
    if (graphPriority >= 0.7) reasons.push("Event touches a systemically important graph node");
  }

  if (event.epistemicStatus === "unverified") {
    capabilities.add("retrieval");
    capabilities.add("evidence-check");
    reasons.push("Event is not yet verified");
  }

  if (event.epistemicStatus === "contradicted" || contradictions > 0) {
    capabilities.add("evidence-check");
    capabilities.add("skeptic-agent");
    reasons.push("Material contradictory evidence requires explicit investigation");
    priority = clamp01(priority + 0.08);
  }

  if (anomaly >= 0.75) {
    capabilities.add("graph-analysis");
    capabilities.add("forecasting");
    reasons.push("Strong anomaly score");
  }

  if (novelty >= 0.75) {
    capabilities.add("retrieval");
    capabilities.add("skeptic-agent");
    reasons.push("Current configuration is historically novel");
  }

  if (domains >= 3) {
    capabilities.add("causal-analysis");
    reasons.push(`Cross-domain reach spans ${domains} domains`);
  }

  const reliability = context.reliability
    ? operationalReliability(context.reliability)
    : 1;

  if (context.forecasts && context.reliability) {
    if (shouldEscalateForEvidence(context.forecasts, context.reliability)) {
      capabilities.add("evidence-check");
      capabilities.add("skeptic-agent");
      reasons.push("Model disagreement or operational reliability requires more evidence");
    }
  }

  if (reliability < 0.6) {
    reasons.push("Sensing/model reliability is degraded");
    // Degraded senses increase review need but reduce confidence in autonomous depth.
    priority = clamp01(priority * 0.9 + 0.05);
  }

  if (verifiedEvidence >= 3 && priority >= 0.65) {
    capabilities.add("causal-analysis");
    capabilities.add("forecasting");
  }

  const highConsequenceEvent =
    event.eventType === "cascade.detected" ||
    event.eventType === "feedback_loop.detected" ||
    event.eventType === "decision.proposed" ||
    event.eventType === "action.executed";

  if (highConsequenceEvent) {
    priority = clamp01(priority + 0.12);
    capabilities.add("human-review");
    reasons.push("High-consequence cognitive event type");
  }

  let route: CognitiveRoute;
  if (priority < 0.2 && event.epistemicStatus !== "contradicted") {
    route = "archive";
  } else if (priority < 0.45) {
    route = "lightweight-analysis";
  } else if (priority < 0.72) {
    route = "deep-investigation";
    capabilities.add("retrieval");
    capabilities.add("evidence-check");
  } else if (
    priority < 0.9 &&
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

  // Unverified events can receive deep investigation, never direct simulation or
  // action-oriented escalation solely because they sound severe.
  if (event.epistemicStatus === "unverified" && route === "simulation") {
    route = "deep-investigation";
  }

  return {
    route,
    priority,
    reasons: reasons.length > 0 ? reasons : ["Routine event routing"],
    requiredCapabilities: [...capabilities],
  };
}

function severityFromEvent(event: CognitiveEvent): number {
  const payloadSeverity = event.payload?.severity;
  if (typeof payloadSeverity === "number") return payloadSeverity;
  if (typeof payloadSeverity !== "string") return 0.3;

  switch (payloadSeverity.toLowerCase()) {
    case "emergency":
      return 1;
    case "critical":
      return 0.9;
    case "high":
      return 0.75;
    case "medium":
      return 0.5;
    case "low":
      return 0.25;
    default:
      return 0.3;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
