import type { PlanetaryGraph, GraphEdge } from "./graph";
import { weaklyConnectedComponents, weightedInfluence } from "./graph";

export type GraphIntervention =
  | { type: "remove-node"; entityId: string }
  | { type: "remove-edge"; relationshipId: string }
  | { type: "weaken-edge"; relationshipId: string; factor: number };

export interface CounterfactualResult {
  intervention: GraphIntervention;
  interventionStatus: "applied" | "withheld_unquantified_target" | "target_not_found";
  baseline: GraphStateSummary;
  counterfactual: GraphStateSummary;
  disconnectedEntities: string[];
  influenceLosses: Array<{ entityId: string; before: number; after: number; delta: number }>;
  influenceComparisonStatus: "complete" | "withheld_incomplete_quantification";
  summary: {
    nodeLoss: number;
    edgeLoss: number;
    componentDelta: number;
    largestComponentDelta: number;
    disconnectedCount: number;
    systemicImpactScore: number;
    systemicImpactSemantics: string;
  };
}

export interface GraphStateSummary {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  largestComponentSize: number;
  reachableFromAnchor?: number;
}

const IMPACT_SEMANTICS = "deterministic_structural_counterfactual_priority_heuristic_not_forecast_or_probability";

/**
 * Deterministic structural counterfactual. It measures graph changes under an
 * explicit intervention; it does not claim the real world will follow the graph.
 * Quantitative weakening is withheld if the targeted edge is unquantified.
 */
export function simulateGraphIntervention(
  graph: PlanetaryGraph,
  intervention: GraphIntervention,
  anchorEntityId?: string,
): CounterfactualResult {
  const baselineInfluence = weightedInfluence(graph);
  const baseline = summarize(graph, anchorEntityId);
  const applied = applyIntervention(graph, intervention);
  const modified = applied.graph;
  const counterfactualInfluence = weightedInfluence(modified);
  const counterfactual = summarize(modified, anchorEntityId);

  const disconnectedEntities = applied.status === "applied" && anchorEntityId
    ? [...graph.nodes.keys()].filter((entityId) =>
        reachable(graph, anchorEntityId, entityId) && !reachable(modified, anchorEntityId, entityId),
      )
    : [];

  const influenceComparisonStatus =
    baselineInfluence.quantitativeCoverage === "complete" &&
    counterfactualInfluence.quantitativeCoverage === "complete"
      ? "complete"
      : "withheld_incomplete_quantification";

  const influenceLosses = influenceComparisonStatus === "complete"
    ? [...baselineInfluence.values.entries()].flatMap(([entityId, before]) => {
        const after = counterfactualInfluence.values.get(entityId);
        if (before === null || after === null || after === undefined) return [];
        const delta = before - after;
        return delta > 0.0001 ? [{ entityId, before, after, delta }] : [];
      }).sort((a, b) => b.delta - a.delta)
    : [];

  const nodeLoss = Math.max(0, baseline.nodeCount - counterfactual.nodeCount);
  const edgeLoss = Math.max(0, baseline.edgeCount - counterfactual.edgeCount);
  const componentDelta = counterfactual.componentCount - baseline.componentCount;
  const largestComponentDelta = baseline.largestComponentSize - counterfactual.largestComponentSize;
  const disconnectedCount = disconnectedEntities.length;
  const systemicImpactScore = applied.status === "applied"
    ? clamp01(
        0.18 * ratio(nodeLoss, baseline.nodeCount) +
          0.22 * ratio(edgeLoss, baseline.edgeCount) +
          0.2 * ratio(Math.max(0, componentDelta), baseline.componentCount) +
          0.2 * ratio(Math.max(0, largestComponentDelta), baseline.largestComponentSize) +
          0.2 * ratio(disconnectedCount, baseline.nodeCount),
      )
    : 0;

  return {
    intervention,
    interventionStatus: applied.status,
    baseline,
    counterfactual,
    disconnectedEntities,
    influenceLosses,
    influenceComparisonStatus,
    summary: {
      nodeLoss,
      edgeLoss,
      componentDelta,
      largestComponentDelta,
      disconnectedCount,
      systemicImpactScore,
      systemicImpactSemantics: applied.status === "applied"
        ? IMPACT_SEMANTICS
        : "not_issued_intervention_not_quantitatively_applied",
    },
  };
}

export function rankStructuralInterventions(
  graph: PlanetaryGraph,
  interventions: GraphIntervention[],
  anchorEntityId?: string,
): CounterfactualResult[] {
  return interventions
    .map((intervention) => simulateGraphIntervention(graph, intervention, anchorEntityId))
    .sort((a, b) => {
      if (a.interventionStatus !== "applied" && b.interventionStatus === "applied") return 1;
      if (a.interventionStatus === "applied" && b.interventionStatus !== "applied") return -1;
      return b.summary.systemicImpactScore - a.summary.systemicImpactScore;
    });
}

function applyIntervention(
  graph: PlanetaryGraph,
  intervention: GraphIntervention,
): { graph: PlanetaryGraph; status: CounterfactualResult["interventionStatus"] } {
  const nodes = new Map(graph.nodes);
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  let verifiedRelationshipCount = 0;
  let quantifiedTraversalEdgeCount = 0;
  let unquantifiedTraversalEdgeCount = 0;
  let targetFound = intervention.type === "remove-node" ? graph.nodes.has(intervention.entityId) : false;
  let targetApplied = intervention.type === "remove-node" && targetFound;
  let withheldUnquantified = false;

  if (intervention.type === "remove-node" && targetFound) nodes.delete(intervention.entityId);

  for (const [source, edges] of graph.outgoing) {
    if (!nodes.has(source)) continue;
    for (const edge of edges) {
      if (!nodes.has(edge.target)) continue;

      if (intervention.type === "remove-edge" && edge.relationshipId === intervention.relationshipId) {
        targetFound = true;
        targetApplied = true;
        continue;
      }

      let nextEdge = edge;
      if (intervention.type === "weaken-edge" && edge.relationshipId === intervention.relationshipId) {
        targetFound = true;
        const factor = unitOrNull(intervention.factor);
        if (
          factor === null ||
          edge.strength === null ||
          edge.confidence === null ||
          edge.traversalScore === null
        ) {
          withheldUnquantified = true;
        } else {
          const strength = clamp01(edge.strength * factor);
          const traversalScore = clamp01(strength * edge.confidence);
          nextEdge = {
            ...edge,
            strength,
            traversalScore,
            cost: 1 / Math.max(0.001, traversalScore),
          };
          targetApplied = true;
        }
      }

      verifiedRelationshipCount += 1;
      if (nextEdge.traversalScore === null) unquantifiedTraversalEdgeCount += 1;
      else quantifiedTraversalEdgeCount += 1;
      push(outgoing, nextEdge.source, nextEdge);
      push(incoming, nextEdge.target, nextEdge);
    }
  }

  const status: CounterfactualResult["interventionStatus"] = !targetFound
    ? "target_not_found"
    : withheldUnquantified && !targetApplied
      ? "withheld_unquantified_target"
      : "applied";

  return {
    status,
    graph: {
      nodes,
      outgoing,
      incoming,
      verifiedRelationshipCount,
      quantifiedTraversalEdgeCount,
      unquantifiedTraversalEdgeCount,
    },
  };
}

function summarize(graph: PlanetaryGraph, anchorEntityId?: string): GraphStateSummary {
  const components = weaklyConnectedComponents(graph);
  let edgeCount = 0;
  for (const edges of graph.outgoing.values()) edgeCount += edges.length;
  return {
    nodeCount: graph.nodes.size,
    edgeCount,
    componentCount: components.length,
    largestComponentSize: components[0]?.length ?? 0,
    reachableFromAnchor: anchorEntityId && graph.nodes.has(anchorEntityId)
      ? [...graph.nodes.keys()].filter((entityId) => reachable(graph, anchorEntityId, entityId)).length
      : undefined,
  };
}

function reachable(graph: PlanetaryGraph, sourceId: string, targetId: string): boolean {
  if (!graph.nodes.has(sourceId) || !graph.nodes.has(targetId)) return false;
  if (sourceId === targetId) return true;
  const visited = new Set<string>([sourceId]);
  const queue = [sourceId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const edge of graph.outgoing.get(current) ?? []) {
      if (edge.target === targetId) return true;
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      queue.push(edge.target);
    }
  }
  return false;
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge) {
  const values = map.get(key);
  if (values) values.push(edge);
  else map.set(key, [edge]);
}

function ratio(value: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return clamp01(value / denominator);
}

function unitOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
