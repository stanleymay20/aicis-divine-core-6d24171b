import type { WorldEntity, WorldRelationship } from "./contracts";
import {
  canEnterVerifiedGraph,
  hasQuantifiedUnitInterval,
} from "./contracts";

const TRAVERSAL_SCORE_SEMANTICS =
  "deterministic_product_of_explicit_relationship_strength_and_confidence_not_probability";
const PATH_SCORE_SEMANTICS =
  "multiplicative_deterministic_traversal_support_score_not_probability";
const INFLUENCE_SEMANTICS =
  "normalized_weighted_outgoing_relationship_score_requires_complete_graph_quantification_not_probability";
const SYSTEMIC_PRIORITY_SEMANTICS =
  "deterministic_operator_priority_heuristic_not_probability";

export interface GraphEdge {
  relationshipId: string;
  source: string;
  target: string;
  type: string;
  strength: number | null;
  strengthSemantics: string | null;
  confidence: number | null;
  confidenceSemantics: string | null;
  traversalScore: number | null;
  traversalScoreSemantics: string;
  cost: number | null;
}

export interface PlanetaryGraph {
  nodes: Map<string, WorldEntity>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
  verifiedRelationshipCount: number;
  quantifiedTraversalEdgeCount: number;
  unquantifiedTraversalEdgeCount: number;
}

export interface PathResult {
  nodeIds: string[];
  edges: GraphEdge[];
  totalCost: number;
  pathEvidenceScore: number | null;
  pathEvidenceScoreSemantics: string;
  quantitativeCoverage: "complete" | "identity_path_no_edges";
}

export interface WeightedInfluenceResult {
  values: Map<string, number | null>;
  semantics: string;
  quantitativeCoverage: "complete" | "incomplete";
  unquantifiedEdgeCount: number;
}

export interface SystemicPriorityResult {
  score: number | null;
  semantics: string;
  evidenceStatus: "complete" | "withheld_incomplete_weighted_graph" | "invalid_input";
}

/**
 * Build the structural graph from relationships that crossed the explicit
 * verification boundary. Numeric confidence is deliberately NOT a graph-admission
 * threshold: verified relationships may legitimately have unknown quantification.
 * Quantitative graph algorithms inspect edge semantics separately.
 */
export function buildVerifiedGraph(
  entities: WorldEntity[],
  relationships: WorldRelationship[],
): PlanetaryGraph {
  const nodes = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  let verifiedRelationshipCount = 0;
  let quantifiedTraversalEdgeCount = 0;
  let unquantifiedTraversalEdgeCount = 0;

  for (const relationship of relationships) {
    if (!canEnterVerifiedGraph(relationship.epistemicStatus, relationship.status)) {
      continue;
    }
    if (!nodes.has(relationship.sourceEntityId) || !nodes.has(relationship.targetEntityId)) {
      continue;
    }

    verifiedRelationshipCount += 1;
    const strength = relationship.strength ?? null;
    const confidence = relationship.confidence ?? null;
    const strengthSemantics = relationship.strengthSemantics ?? null;
    const confidenceSemantics = relationship.confidenceSemantics ?? null;
    const strengthUsable = hasQuantifiedUnitInterval(strength, strengthSemantics);
    const confidenceUsable = hasQuantifiedUnitInterval(confidence, confidenceSemantics);
    const traversalScore = strengthUsable && confidenceUsable
      ? clamp01(strength * confidence)
      : null;
    const cost = traversalScore === null
      ? null
      : 1 / Math.max(0.001, traversalScore);

    if (traversalScore === null) unquantifiedTraversalEdgeCount += 1;
    else quantifiedTraversalEdgeCount += 1;

    const edge: GraphEdge = {
      relationshipId: relationship.id,
      source: relationship.sourceEntityId,
      target: relationship.targetEntityId,
      type: relationship.relationshipType,
      strength,
      strengthSemantics,
      confidence,
      confidenceSemantics,
      traversalScore,
      traversalScoreSemantics: TRAVERSAL_SCORE_SEMANTICS,
      cost,
    };

    pushMap(outgoing, edge.source, edge);
    pushMap(incoming, edge.target, edge);
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

/** Structural degree centrality uses edge existence only; it is not confidence. */
export function degreeCentrality(graph: PlanetaryGraph): Map<string, number> {
  const denominator = Math.max(1, graph.nodes.size - 1);
  const result = new Map<string, number>();

  for (const id of graph.nodes.keys()) {
    const neighbors = new Set<string>();
    for (const edge of graph.outgoing.get(id) ?? []) neighbors.add(edge.target);
    for (const edge of graph.incoming.get(id) ?? []) neighbors.add(edge.source);
    result.set(id, neighbors.size / denominator);
  }
  return result;
}

/**
 * Weighted influence is only normalized when every verified graph edge has
 * explicit usable strength and confidence semantics. Otherwise the network-wide
 * denominator itself is unknown, so returning partial normalized values would be
 * misleading. Zero remains valid when the fully quantified graph has no outgoing
 * weighted influence for a node.
 */
export function weightedInfluence(graph: PlanetaryGraph): WeightedInfluenceResult {
  if (graph.unquantifiedTraversalEdgeCount > 0) {
    return {
      values: new Map([...graph.nodes.keys()].map((id) => [id, null])),
      semantics: INFLUENCE_SEMANTICS,
      quantitativeCoverage: "incomplete",
      unquantifiedEdgeCount: graph.unquantifiedTraversalEdgeCount,
    };
  }

  const raw = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    const score = (graph.outgoing.get(id) ?? []).reduce((sum, edge) => {
      return sum + (edge.traversalScore ?? 0);
    }, 0);
    raw.set(id, score);
  }

  return {
    values: normalizeComplete(raw),
    semantics: INFLUENCE_SEMANTICS,
    quantitativeCoverage: "complete",
    unquantifiedEdgeCount: 0,
  };
}

/**
 * Dijkstra over explicitly quantified deterministic traversal scores. Structural
 * edges with unknown strength/confidence remain in the graph but are not silently
 * assigned a cost. The resulting path score is a heuristic support score, never a
 * probability or calibrated confidence.
 */
export function strongestPath(
  graph: PlanetaryGraph,
  sourceId: string,
  targetId: string,
): PathResult | null {
  if (!graph.nodes.has(sourceId) || !graph.nodes.has(targetId)) return null;
  if (sourceId === targetId) {
    return {
      nodeIds: [sourceId],
      edges: [],
      totalCost: 0,
      pathEvidenceScore: null,
      pathEvidenceScoreSemantics: "identity_path_has_no_edge_evidence_score",
      quantitativeCoverage: "identity_path_no_edges",
    };
  }

  const distance = new Map<string, number>();
  const previous = new Map<string, GraphEdge>();
  const unvisited = new Set(graph.nodes.keys());
  for (const id of unvisited) distance.set(id, Number.POSITIVE_INFINITY);
  distance.set(sourceId, 0);

  while (unvisited.size > 0) {
    let current: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const id of unvisited) {
      const candidate = distance.get(id) ?? Number.POSITIVE_INFINITY;
      if (candidate < currentDistance) {
        current = id;
        currentDistance = candidate;
      }
    }

    if (current === null || !Number.isFinite(currentDistance)) break;
    unvisited.delete(current);
    if (current === targetId) break;

    for (const edge of graph.outgoing.get(current) ?? []) {
      if (!unvisited.has(edge.target) || edge.cost === null) continue;
      const next = currentDistance + edge.cost;
      if (next < (distance.get(edge.target) ?? Number.POSITIVE_INFINITY)) {
        distance.set(edge.target, next);
        previous.set(edge.target, edge);
      }
    }
  }

  if (!previous.has(targetId)) return null;

  const edges: GraphEdge[] = [];
  const nodeIds = [targetId];
  let cursor = targetId;
  while (cursor !== sourceId) {
    const edge = previous.get(cursor);
    if (!edge || edge.traversalScore === null) return null;
    edges.unshift(edge);
    cursor = edge.source;
    nodeIds.unshift(cursor);
  }

  const totalCost = distance.get(targetId);
  if (totalCost === undefined || !Number.isFinite(totalCost)) return null;

  return {
    nodeIds,
    edges,
    totalCost,
    pathEvidenceScore: edges.reduce(
      (product, edge) => product * (edge.traversalScore as number),
      1,
    ),
    pathEvidenceScoreSemantics: PATH_SCORE_SEMANTICS,
    quantitativeCoverage: "complete",
  };
}

/**
 * Directed structural reachability up to N hops. Reachability means a verified
 * edge exists; it does not imply causation or quantitative propagation strength.
 */
export function downstreamRadius(
  graph: PlanetaryGraph,
  sourceId: string,
  maxHops = 3,
): Map<string, number> {
  const distance = new Map<string, number>();
  if (!graph.nodes.has(sourceId) || !Number.isInteger(maxHops) || maxHops < 0) {
    return distance;
  }

  const queue: Array<{ id: string; hops: number }> = [{ id: sourceId, hops: 0 }];
  distance.set(sourceId, 0);

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || next.hops >= maxHops) continue;

    for (const edge of graph.outgoing.get(next.id) ?? []) {
      if (distance.has(edge.target)) continue;
      const hops = next.hops + 1;
      distance.set(edge.target, hops);
      queue.push({ id: edge.target, hops });
    }
  }

  return distance;
}

/** Structural weak components; semantic interpretation belongs above this layer. */
export function weaklyConnectedComponents(graph: PlanetaryGraph): string[][] {
  const remaining = new Set(graph.nodes.keys());
  const components: string[][] = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value as string;
    const component: string[] = [];
    const queue = [seed];
    remaining.delete(seed);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);

      const neighbors = new Set<string>();
      for (const edge of graph.outgoing.get(current) ?? []) neighbors.add(edge.target);
      for (const edge of graph.incoming.get(current) ?? []) neighbors.add(edge.source);

      for (const neighbor of neighbors) {
        if (!remaining.has(neighbor)) continue;
        remaining.delete(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

/**
 * Returns directed cycle candidates only within the supplied maxDepth/maxCycles
 * bounds. Hitting either bound means the result is not an exhaustive cycle census.
 */
export function findDirectedCycles(
  graph: PlanetaryGraph,
  maxDepth = 8,
  maxCycles = 100,
): string[][] {
  if (!Number.isInteger(maxDepth) || maxDepth < 2) return [];
  if (!Number.isInteger(maxCycles) || maxCycles < 1) return [];

  const cycles: string[][] = [];
  const seen = new Set<string>();

  const visit = (start: string, current: string, path: string[], active: Set<string>) => {
    if (cycles.length >= maxCycles || path.length > maxDepth) return;

    for (const edge of graph.outgoing.get(current) ?? []) {
      if (edge.target === start && path.length >= 2) {
        const cycle = [...path, start];
        const key = canonicalCycleKey(cycle.slice(0, -1));
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
        continue;
      }
      if (active.has(edge.target)) continue;

      active.add(edge.target);
      visit(start, edge.target, [...path, edge.target], active);
      active.delete(edge.target);
    }
  };

  for (const id of graph.nodes.keys()) {
    visit(id, id, [id], new Set([id]));
    if (cycles.length >= maxCycles) break;
  }

  return cycles;
}

/**
 * Deterministic operator-priority heuristic. It abstains when network-weighted
 * influence cannot be computed from complete quantified graph inputs.
 */
export function systemicPriority(
  graph: PlanetaryGraph,
  nodeId: string,
  anomalyScore: number,
  noveltyScore: number,
  severity: number,
): SystemicPriorityResult {
  if (
    !graph.nodes.has(nodeId) ||
    !isUnitInterval(anomalyScore) ||
    !isUnitInterval(noveltyScore) ||
    !isUnitInterval(severity)
  ) {
    return {
      score: null,
      semantics: SYSTEMIC_PRIORITY_SEMANTICS,
      evidenceStatus: "invalid_input",
    };
  }

  const degree = degreeCentrality(graph).get(nodeId);
  const influenceResult = weightedInfluence(graph);
  const influence = influenceResult.values.get(nodeId);
  if (degree === undefined || influence === undefined || influence === null) {
    return {
      score: null,
      semantics: SYSTEMIC_PRIORITY_SEMANTICS,
      evidenceStatus: "withheld_incomplete_weighted_graph",
    };
  }

  return {
    score: clamp01(
      0.22 * anomalyScore +
      0.18 * noveltyScore +
      0.20 * severity +
      0.18 * degree +
      0.22 * influence,
    ),
    semantics: SYSTEMIC_PRIORITY_SEMANTICS,
    evidenceStatus: "complete",
  };
}

function pushMap(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge) {
  const entries = map.get(key);
  if (entries) entries.push(edge);
  else map.set(key, [edge]);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeComplete(values: Map<string, number>): Map<string, number> {
  const max = Math.max(0, ...values.values());
  if (max === 0) return new Map([...values.keys()].map((key) => [key, 0]));
  return new Map([...values.entries()].map(([key, value]) => [key, value / max]));
}

function canonicalCycleKey(cycle: string[]): string {
  if (cycle.length === 0) return "";
  const rotations = cycle.map((_, index) => [
    ...cycle.slice(index),
    ...cycle.slice(0, index),
  ].join("→"));
  return rotations.sort()[0];
}
