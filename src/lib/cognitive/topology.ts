import type { PlanetaryGraph } from "./graph";
import { degreeCentrality, findDirectedCycles, weaklyConnectedComponents, weightedInfluence } from "./graph";

export interface NodeTopologyState {
  nodeId: string;
  degreeCentrality: number;
  influence: number | null;
  outgoingEdges: number;
  incomingEdges: number;
}

export interface GraphTopologySnapshot {
  capturedAt: string;
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  largestComponentSize: number;
  cycleCount: number;
  influenceCoverage: "complete" | "incomplete";
  nodes: Map<string, NodeTopologyState>;
}

export type TopologyChangeKind =
  | "node.emerged"
  | "node.disappeared"
  | "connector.emerged"
  | "connector.weakened"
  | "influence.surge"
  | "influence.drop"
  | "cluster.merged"
  | "cluster.fragmented"
  | "feedback.emerged"
  | "feedback.disappeared";

export interface TopologyChange {
  kind: TopologyChangeKind;
  severity: number;
  nodeId?: string;
  previousValue?: number;
  currentValue?: number;
  delta?: number;
  evidence: Record<string, unknown>;
}

export interface TopologyDiffOptions {
  centralityDeltaThreshold?: number;
  influenceDeltaThreshold?: number;
  connectorThreshold?: number;
  materialityFloor?: number;
}

/**
 * Captures deterministic structure and keeps weighted influence NULL when the
 * verified graph is not fully quantified. Structural degree remains measurable.
 */
export function captureTopology(
  graph: PlanetaryGraph,
  capturedAt = new Date().toISOString(),
): GraphTopologySnapshot {
  const centrality = degreeCentrality(graph);
  const influence = weightedInfluence(graph);
  const components = weaklyConnectedComponents(graph);
  const cycles = findDirectedCycles(graph, 8, 500);
  const nodes = new Map<string, NodeTopologyState>();

  let edgeCount = 0;
  for (const [nodeId] of graph.nodes) {
    const outgoingEdges = graph.outgoing.get(nodeId)?.length ?? 0;
    const incomingEdges = graph.incoming.get(nodeId)?.length ?? 0;
    edgeCount += outgoingEdges;
    nodes.set(nodeId, {
      nodeId,
      degreeCentrality: centrality.get(nodeId) ?? 0,
      influence: influence.values.get(nodeId) ?? null,
      outgoingEdges,
      incomingEdges,
    });
  }

  return {
    capturedAt,
    nodeCount: graph.nodes.size,
    edgeCount,
    componentCount: components.length,
    largestComponentSize: components[0]?.length ?? 0,
    cycleCount: cycles.length,
    influenceCoverage: influence.quantitativeCoverage,
    nodes,
  };
}

/**
 * Structural changes are always comparable. Influence changes are emitted only
 * when both snapshots contain quantified influence for the node.
 */
export function diffTopology(
  previous: GraphTopologySnapshot,
  current: GraphTopologySnapshot,
  options: TopologyDiffOptions = {},
): TopologyChange[] {
  const centralityDeltaThreshold = options.centralityDeltaThreshold ?? 0.15;
  const influenceDeltaThreshold = options.influenceDeltaThreshold ?? 0.2;
  const connectorThreshold = options.connectorThreshold ?? 0.35;
  const materialityFloor = options.materialityFloor ?? 0.08;
  const changes: TopologyChange[] = [];

  const nodeIds = new Set([...previous.nodes.keys(), ...current.nodes.keys()]);
  for (const nodeId of nodeIds) {
    const before = previous.nodes.get(nodeId);
    const after = current.nodes.get(nodeId);

    if (!before && after) {
      changes.push({
        kind: "node.emerged",
        nodeId,
        severity: nodePresencePriority(after.degreeCentrality, after.influence),
        currentValue: after.degreeCentrality,
        evidence: { current: after, influence_quantified: after.influence !== null },
      });
      continue;
    }

    if (before && !after) {
      changes.push({
        kind: "node.disappeared",
        nodeId,
        severity: nodePresencePriority(before.degreeCentrality, before.influence),
        previousValue: before.degreeCentrality,
        evidence: { previous: before, influence_quantified: before.influence !== null },
      });
      continue;
    }

    if (!before || !after) continue;

    const centralityDelta = after.degreeCentrality - before.degreeCentrality;

    if (
      before.degreeCentrality < connectorThreshold &&
      after.degreeCentrality >= connectorThreshold &&
      centralityDelta >= centralityDeltaThreshold
    ) {
      changes.push({
        kind: "connector.emerged",
        nodeId,
        severity: clamp01(0.4 + centralityDelta),
        previousValue: before.degreeCentrality,
        currentValue: after.degreeCentrality,
        delta: centralityDelta,
        evidence: { before, after },
      });
    } else if (
      before.degreeCentrality >= connectorThreshold &&
      after.degreeCentrality < connectorThreshold &&
      -centralityDelta >= centralityDeltaThreshold
    ) {
      changes.push({
        kind: "connector.weakened",
        nodeId,
        severity: clamp01(0.35 - centralityDelta),
        previousValue: before.degreeCentrality,
        currentValue: after.degreeCentrality,
        delta: centralityDelta,
        evidence: { before, after },
      });
    }

    if (before.influence !== null && after.influence !== null) {
      const influenceDelta = after.influence - before.influence;
      if (influenceDelta >= influenceDeltaThreshold) {
        changes.push({
          kind: "influence.surge",
          nodeId,
          severity: clamp01(0.3 + influenceDelta),
          previousValue: before.influence,
          currentValue: after.influence,
          delta: influenceDelta,
          evidence: { before, after },
        });
      } else if (-influenceDelta >= influenceDeltaThreshold) {
        changes.push({
          kind: "influence.drop",
          nodeId,
          severity: clamp01(0.25 - influenceDelta),
          previousValue: before.influence,
          currentValue: after.influence,
          delta: influenceDelta,
          evidence: { before, after },
        });
      }
    }
  }

  if (current.componentCount < previous.componentCount) {
    const delta = previous.componentCount - current.componentCount;
    changes.push({
      kind: "cluster.merged",
      severity: clamp01(materialityFloor + delta / Math.max(1, previous.componentCount)),
      previousValue: previous.componentCount,
      currentValue: current.componentCount,
      delta: -delta,
      evidence: {
        previousLargestComponentSize: previous.largestComponentSize,
        currentLargestComponentSize: current.largestComponentSize,
      },
    });
  } else if (current.componentCount > previous.componentCount) {
    const delta = current.componentCount - previous.componentCount;
    changes.push({
      kind: "cluster.fragmented",
      severity: clamp01(materialityFloor + delta / Math.max(1, current.componentCount)),
      previousValue: previous.componentCount,
      currentValue: current.componentCount,
      delta,
      evidence: {
        previousLargestComponentSize: previous.largestComponentSize,
        currentLargestComponentSize: current.largestComponentSize,
      },
    });
  }

  if (current.cycleCount > previous.cycleCount) {
    const delta = current.cycleCount - previous.cycleCount;
    changes.push({
      kind: "feedback.emerged",
      severity: clamp01(0.35 + delta / Math.max(1, current.cycleCount)),
      previousValue: previous.cycleCount,
      currentValue: current.cycleCount,
      delta,
      evidence: { bounded_cycle_scan: true },
    });
  } else if (current.cycleCount < previous.cycleCount) {
    const delta = previous.cycleCount - current.cycleCount;
    changes.push({
      kind: "feedback.disappeared",
      severity: clamp01(0.2 + delta / Math.max(1, previous.cycleCount)),
      previousValue: previous.cycleCount,
      currentValue: current.cycleCount,
      delta: -delta,
      evidence: { bounded_cycle_scan: true },
    });
  }

  return changes
    .filter((change) => change.severity >= materialityFloor)
    .sort((a, b) => b.severity - a.severity);
}

export function topologyNoveltyScore(changes: TopologyChange[]): number {
  if (changes.length === 0) return 0;
  const weighted = changes.reduce((sum, change) => {
    const noveltyMultiplier =
      change.kind === "connector.emerged" ||
      change.kind === "cluster.merged" ||
      change.kind === "feedback.emerged"
        ? 1.15
        : 1;
    return sum + clamp01(change.severity * noveltyMultiplier);
  }, 0);
  return clamp01(weighted / Math.max(1, Math.min(5, changes.length)));
}

export function topologyChangeSummary(changes: TopologyChange[]): {
  total: number;
  critical: number;
  highestSeverity: number;
  affectedNodes: string[];
  kinds: Record<TopologyChangeKind, number>;
} {
  const kinds = {
    "node.emerged": 0,
    "node.disappeared": 0,
    "connector.emerged": 0,
    "connector.weakened": 0,
    "influence.surge": 0,
    "influence.drop": 0,
    "cluster.merged": 0,
    "cluster.fragmented": 0,
    "feedback.emerged": 0,
    "feedback.disappeared": 0,
  } satisfies Record<TopologyChangeKind, number>;

  for (const change of changes) kinds[change.kind] += 1;

  return {
    total: changes.length,
    critical: changes.filter((change) => change.severity >= 0.8).length,
    highestSeverity: Math.max(0, ...changes.map((change) => change.severity)),
    affectedNodes: [...new Set(changes.flatMap((change) => (change.nodeId ? [change.nodeId] : [])))],
    kinds,
  };
}

function nodePresencePriority(degreeCentrality: number, influence: number | null): number {
  const structural = clamp01(degreeCentrality);
  const weighted = influence === null ? null : clamp01(influence);
  const combined = weighted === null ? structural : 0.5 * structural + 0.5 * weighted;
  return clamp01(0.2 + 0.8 * combined);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
