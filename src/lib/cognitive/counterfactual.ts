import type { PlanetaryGraph, GraphEdge } from "./graph";
import { weaklyConnectedComponents, weightedInfluence } from "./graph";

export type GraphIntervention =
  | { type: "remove-node"; entityId: string }
  | { type: "remove-edge"; relationshipId: string }
  | { type: "weaken-edge"; relationshipId: string; factor: number };

export interface CounterfactualResult {
  intervention: GraphIntervention;
  baseline: GraphStateSummary;
  counterfactual: GraphStateSummary;
  disconnectedEntities: string[];
  influenceLosses: Array<{ entityId: string; before: number; after: number; delta: number }>;
  summary: {
    nodeLoss: number;
    edgeLoss: number;
    componentDelta: number;
    largestComponentDelta: number;
    disconnectedCount: number;
    systemicImpactScore: number;
  };
}

export interface GraphStateSummary {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  largestComponentSize: number;
  reachableFromAnchor?: number;
}

/**
 * Deterministic structural counterfactual. This answers "what changes in the
 * verified dependency graph if X is removed/weakened?" It does not claim that
 * the real world will follow the graph exactly; causal/simulation layers must
 * interpret the result with uncertainty.
 */
export function simulateGraphIntervention(
  graph: PlanetaryGraph,
  intervention: GraphIntervention,
  anchorEntityId?: string,
): CounterfactualResult {
  const baselineInfluence = weightedInfluence(graph);
  const baseline = summarize(graph, anchorEntityId);
  const modified = applyIntervention(graph, intervention);
  const counterfactualInfluence = weightedInfluence(modified);
  const counterfactual = summarize(modified, anchorEntityId);

  const disconnectedEntities = anchorEntityId
    ? [...graph.nodes.keys()].filter((entityId) =>
        reachable(graph, anchorEntityId, entityId) && !reachable(modified, anchorEntityId, entityId),
      )
    : [];

  const influenceLosses = [...baselineInfluence.values.entries()]
    .map(([entityId, rawBefore]) => {
      const before = rawBefore ?? 0;
      const after = counterfactualInfluence.values.get(entityId) ?? 0;
      return { entityId, before, after, delta: before - after };
    })
    .filter((item) => item.delta > 0.0001)
    .sort((a, b) => b.delta - a.delta);

  const nodeLoss = Math.max(0, baseline.nodeCount - counterfactual.nodeCount);
  const edgeLoss = Math.max(0, baseline.edgeCount - counterfactual.edgeCount);
  const componentDelta = counterfactual.componentCount - baseline.componentCount;
  const largestComponentDelta = baseline.largestComponentSize - counterfactual.largestComponentSize;
  const disconnectedCount = disconnectedEntities.length;
  const systemicImpactScore = clamp01(
    0.18 * ratio(nodeLoss, baseline.nodeCount) +
      0.22 * ratio(edgeLoss, baseline.edgeCount) +
      0.2 * clamp01(Math.max(0, componentDelta) / Math.max(1, baseline.componentCount)) +
      0.2 * ratio(Math.max(0, largestComponentDelta), baseline.largestComponentSize) +
      0.2 * ratio(disconnectedCount, baseline.nodeCount),
  );

  return {
    intervention,
    baseline,
    counterfactual,
    disconnectedEntities,
    influenceLosses,
    summary: {
      nodeLoss,
      edgeLoss,
      componentDelta,
      largestComponentDelta,
      disconnectedCount,
      systemicImpactScore,
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
    .sort((a, b) => b.summary.systemicImpactScore - a.summary.systemicImpactScore);
}

function applyIntervention(graph: PlanetaryGraph, intervention: GraphIntervention): PlanetaryGraph {
  const nodes = new Map(graph.nodes);
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  let verifiedRelationshipCount = 0;
  let quantifiedTraversalEdgeCount = 0;
  let unquantifiedTraversalEdgeCount = 0;

  if (intervention.type === "remove-node") nodes.delete(intervention.entityId);

  for (const [source, edges] of graph.outgoing) {
    if (!nodes.has(source)) continue;
    for (const edge of edges) {
      if (!nodes.has(edge.target)) continue;
      if (intervention.type === "remove-edge" && edge.relationshipId === intervention.relationshipId) continue;

      let nextEdge = edge;
      if (intervention.type === "weaken-edge" && edge.relationshipId === intervention.relationshipId) {
        const factor = clamp01(intervention.factor);
        const strength = clamp01(edge.strength * factor);
        nextEdge = {
          ...edge,
          strength,
          cost: 1 / Math.max(0.001, strength * edge.confidence),
        };
      }

      verifiedRelationshipCount += 1;
      if (nextEdge.traversalScore === null) unquantifiedTraversalEdgeCount += 1;
      else quantifiedTraversalEdgeCount += 1;

      push(outgoing, nextEdge.source, nextEdge);
      push(incoming, nextEdge.target, nextEdge);
    }
  }

  return {
    nodes,
    outgoing,
    incoming,
    verifiedRelationshipCount,
    quantifiedTraversalEdgeCount,
    unquantifiedTraversalEdgeCount,
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
