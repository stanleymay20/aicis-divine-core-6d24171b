import type { PlanetaryGraph, GraphEdge } from "./graph";

export interface CascadeStep {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipId: string;
  relationshipType: string;
  edgeConfidence: number;
  edgeStrength: number;
  cumulativeConfidence: number;
}

export interface CascadeCandidate {
  originEntityId: string;
  terminalEntityId: string;
  nodeIds: string[];
  steps: CascadeStep[];
  hops: number;
  cumulativeConfidence: number;
  averageStrength: number;
  crossDomainCount: number;
  systemicScore: number;
}

export interface CascadeDetectionOptions {
  maxHops?: number;
  minEdgeConfidence?: number;
  minEdgeStrength?: number;
  minCumulativeConfidence?: number;
  maxCandidates?: number;
  entityDomain?: (entityId: string) => string | undefined;
}

/**
 * Enumerates plausible propagation chains over verified graph edges. This is a
 * structural cascade detector, not a causal proof engine. Causal promotion should
 * happen only after each edge is assessed by the causal layer.
 */
export function detectCascadeCandidates(
  graph: PlanetaryGraph,
  originEntityId: string,
  options: CascadeDetectionOptions = {},
): CascadeCandidate[] {
  if (!graph.nodes.has(originEntityId)) return [];

  const maxHops = Math.max(1, options.maxHops ?? 5);
  const minEdgeConfidence = clamp01(options.minEdgeConfidence ?? 0.5);
  const minEdgeStrength = clamp01(options.minEdgeStrength ?? 0.35);
  const minCumulativeConfidence = clamp01(options.minCumulativeConfidence ?? 0.2);
  const maxCandidates = Math.max(1, options.maxCandidates ?? 200);
  const results: CascadeCandidate[] = [];

  type Frame = {
    current: string;
    nodeIds: string[];
    steps: CascadeStep[];
    confidence: number;
    strengthSum: number;
    domains: Set<string>;
  };

  const initialDomains = new Set<string>();
  const originDomain = options.entityDomain?.(originEntityId);
  if (originDomain) initialDomains.add(originDomain);

  const stack: Frame[] = [{
    current: originEntityId,
    nodeIds: [originEntityId],
    steps: [],
    confidence: 1,
    strengthSum: 0,
    domains: initialDomains,
  }];

  while (stack.length > 0 && results.length < maxCandidates) {
    const frame = stack.pop();
    if (!frame || frame.steps.length >= maxHops) continue;

    for (const edge of graph.outgoing.get(frame.current) ?? []) {
      if (frame.nodeIds.includes(edge.target)) continue;
      if (edge.confidence < minEdgeConfidence || edge.strength < minEdgeStrength) continue;

      const cumulativeConfidence = frame.confidence * edge.confidence;
      if (cumulativeConfidence < minCumulativeConfidence) continue;

      const nodeIds = [...frame.nodeIds, edge.target];
      const domains = new Set(frame.domains);
      const targetDomain = options.entityDomain?.(edge.target);
      if (targetDomain) domains.add(targetDomain);

      const step: CascadeStep = {
        sourceEntityId: edge.source,
        targetEntityId: edge.target,
        relationshipId: edge.relationshipId,
        relationshipType: edge.type,
        edgeConfidence: edge.confidence,
        edgeStrength: edge.strength,
        cumulativeConfidence,
      };
      const steps = [...frame.steps, step];
      const strengthSum = frame.strengthSum + edge.strength;
      const averageStrength = strengthSum / steps.length;
      const crossDomainCount = domains.size;
      const systemicScore = cascadeSystemicScore(
        steps.length,
        cumulativeConfidence,
        averageStrength,
        crossDomainCount,
      );

      results.push({
        originEntityId,
        terminalEntityId: edge.target,
        nodeIds,
        steps,
        hops: steps.length,
        cumulativeConfidence,
        averageStrength,
        crossDomainCount,
        systemicScore,
      });

      stack.push({
        current: edge.target,
        nodeIds,
        steps,
        confidence: cumulativeConfidence,
        strengthSum,
        domains,
      });

      if (results.length >= maxCandidates) break;
    }
  }

  return results.sort((a, b) => b.systemicScore - a.systemicScore);
}

export interface CascadeComparison {
  newPaths: CascadeCandidate[];
  strengthenedPaths: Array<{ current: CascadeCandidate; previous: CascadeCandidate; delta: number }>;
  disappearedPaths: CascadeCandidate[];
}

/** Compares cascade structure across graph snapshots using a stable path key. */
export function compareCascadeCandidates(
  previous: CascadeCandidate[],
  current: CascadeCandidate[],
  strengtheningThreshold = 0.15,
): CascadeComparison {
  const previousByKey = new Map(previous.map((candidate) => [pathKey(candidate), candidate]));
  const currentByKey = new Map(current.map((candidate) => [pathKey(candidate), candidate]));

  const newPaths: CascadeCandidate[] = [];
  const strengthenedPaths: Array<{ current: CascadeCandidate; previous: CascadeCandidate; delta: number }> = [];
  const disappearedPaths: CascadeCandidate[] = [];

  for (const [key, candidate] of currentByKey) {
    const old = previousByKey.get(key);
    if (!old) {
      newPaths.push(candidate);
      continue;
    }
    const delta = candidate.systemicScore - old.systemicScore;
    if (delta >= strengtheningThreshold) strengthenedPaths.push({ current: candidate, previous: old, delta });
  }

  for (const [key, candidate] of previousByKey) {
    if (!currentByKey.has(key)) disappearedPaths.push(candidate);
  }

  return { newPaths, strengthenedPaths, disappearedPaths };
}

export function cascadeSystemicScore(
  hops: number,
  cumulativeConfidence: number,
  averageStrength: number,
  crossDomainCount: number,
): number {
  const reach = clamp01(hops / 5);
  const domains = clamp01(crossDomainCount / 5);
  return clamp01(
    0.28 * clamp01(cumulativeConfidence) +
    0.27 * clamp01(averageStrength) +
    0.2 * reach +
    0.25 * domains,
  );
}

export function edgePropagationProbability(edge: GraphEdge): number {
  return clamp01(edge.confidence * edge.strength);
}

function pathKey(candidate: CascadeCandidate): string {
  return candidate.nodeIds.join("→");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
