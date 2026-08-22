import type { WorldEntity, WorldRelationship } from "./contracts";
import { canEnterVerifiedGraph } from "./contracts";

export interface GraphEdge {
  relationshipId: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  confidence: number;
  cost: number;
}

export interface PlanetaryGraph {
  nodes: Map<string, WorldEntity>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
}

export interface PathResult {
  nodeIds: string[];
  edges: GraphEdge[];
  totalCost: number;
  pathConfidence: number;
}

/**
 * Builds a computation graph only from relationships that have crossed the
 * verified-knowledge boundary. Proposed/unverified/contradicted edges remain
 * outside deterministic planetary calculations.
 */
export function buildVerifiedGraph(
  entities: WorldEntity[],
  relationships: WorldRelationship[],
): PlanetaryGraph {
  const nodes = new Map(entities.map((entity) => [entity.id, entity]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();

  for (const relationship of relationships) {
    if (
      !canEnterVerifiedGraph(
        relationship.epistemicStatus,
        relationship.status,
        relationship.confidence,
      )
    ) {
      continue;
    }
    if (!nodes.has(relationship.sourceEntityId) || !nodes.has(relationship.targetEntityId)) {
      continue;
    }

    const strength = clamp01(relationship.strength ?? relationship.confidence);
    const confidence = clamp01(relationship.confidence);
    // Strong, well-supported relationships should be easier to traverse.
    // EPS prevents zero-cost edges while retaining monotonic ordering.
    const cost = 1 / Math.max(0.001, strength * confidence);
    const edge: GraphEdge = {
      relationshipId: relationship.id,
      source: relationship.sourceEntityId,
      target: relationship.targetEntityId,
      type: relationship.relationshipType,
      strength,
      confidence,
      cost,
    };

    pushMap(outgoing, edge.source, edge);
    pushMap(incoming, edge.target, edge);
  }

  return { nodes, outgoing, incoming };
}

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

export function weightedInfluence(graph: PlanetaryGraph): Map<string, number> {
  const scores = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    const outgoing = graph.outgoing.get(id) ?? [];
    const score = outgoing.reduce(
      (sum, edge) => sum + edge.strength * edge.confidence,
      0,
    );
    scores.set(id, score);
  }
  return normalize(scores);
}

/**
 * Dijkstra over relationship cost. By default, stronger and more confident
 * dependencies form the preferred propagation route.
 */
export function strongestPath(
  graph: PlanetaryGraph,
  sourceId: string,
  targetId: string,
): PathResult | null {
  if (!graph.nodes.has(sourceId) || !graph.nodes.has(targetId)) return null;
  if (sourceId === targetId) {
    return { nodeIds: [sourceId], edges: [], totalCost: 0, pathConfidence: 1 };
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
      if (!unvisited.has(edge.target)) continue;
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
    if (!edge) return null;
    edges.unshift(edge);
    cursor = edge.source;
    nodeIds.unshift(cursor);
  }

  return {
    nodeIds,
    edges,
    totalCost: distance.get(targetId) ?? Number.POSITIVE_INFINITY,
    // Confidence compounds across the path rather than staying magically high.
    pathConfidence: edges.reduce((p, edge) => p * edge.confidence, 1),
  };
}

/**
 * Finds the directed downstream shock radius up to N hops. Useful for interactive
 * cascade exploration without pretending each reachable node is causally certain.
 */
export function downstreamRadius(
  graph: PlanetaryGraph,
  sourceId: string,
  maxHops = 3,
): Map<string, number> {
  const distance = new Map<string, number>();
  if (!graph.nodes.has(sourceId) || maxHops < 0) return distance;

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

/**
 * Weak components expose clusters/cascade boundaries even when edge direction
 * differs. This is deliberately deterministic; semantic interpretation stays above.
 */
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
 * Returns simple directed cycles up to maxDepth. These are candidates for
 * reinforcing feedback loops; they are NOT automatically labelled causal loops.
 */
export function findDirectedCycles(
  graph: PlanetaryGraph,
  maxDepth = 8,
  maxCycles = 100,
): string[][] {
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

export function systemicPriority(
  graph: PlanetaryGraph,
  nodeId: string,
  anomalyScore: number,
  noveltyScore: number,
  severity: number,
): number {
  const degree = degreeCentrality(graph).get(nodeId) ?? 0;
  const influence = weightedInfluence(graph).get(nodeId) ?? 0;
  return clamp01(
    0.22 * clamp01(anomalyScore) +
      0.18 * clamp01(noveltyScore) +
      0.2 * clamp01(severity) +
      0.18 * degree +
      0.22 * influence,
  );
}

function pushMap(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge) {
  const entries = map.get(key);
  if (entries) entries.push(edge);
  else map.set(key, [edge]);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalize(values: Map<string, number>): Map<string, number> {
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
