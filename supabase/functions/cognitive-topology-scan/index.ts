import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-topology-scan";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEGREE_SEMANTICS = "deterministic_verified_graph_degree_centrality_v2";
const INFLUENCE_SEMANTICS = "mean_explicit_edge_strength_times_explicit_edge_confidence_v2_heuristic";
const UNKNOWN_INFLUENCE_SEMANTICS = "withheld_incomplete_quantitative_edge_semantics";
const ZERO_OUTFLOW_SEMANTICS = "deterministic_zero_no_outgoing_verified_edges";
const SEVERITY_SEMANTICS = "deterministic_topology_operator_priority_heuristic_v2_not_probability";
const CYCLE_MAX_DEPTH = 8;
const CYCLE_MAX_COUNT = 500;
const CYCLE_SEMANTICS = `bounded_directed_simple_cycle_detection_max_depth_${CYCLE_MAX_DEPTH}_max_count_${CYCLE_MAX_COUNT}`;
const CONNECTOR_THRESHOLD = 0.35;
const CONNECTOR_DELTA_THRESHOLD = 0.15;
const INFLUENCE_DELTA_THRESHOLD = 0.2;

type Edge = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  strength_semantics: string | null;
  confidence: number | null;
  confidence_semantics: string | null;
};

type NodeState = {
  entity_id: string;
  degree_centrality: number;
  degree_centrality_semantics: string;
  influence: number | null;
  influence_semantics: string;
  influence_coverage: number;
  outgoing_edges: number;
  incoming_edges: number;
};

type DbNodeSnapshot = {
  entity_id: string;
  degree_centrality: number | string | null;
  degree_centrality_semantics: string | null;
  influence: number | string | null;
  influence_semantics: string | null;
  influence_coverage: number | string | null;
  outgoing_edges: number | string | null;
  incoming_edges: number | string | null;
};

type PreviousSnapshot = {
  id: string;
  node_count: number;
  edge_count: number;
  component_count: number;
  largest_component_size: number;
  cycle_count: number;
  cycle_count_semantics: string | null;
  cycle_scan_max_depth: number | null;
  cycle_scan_max_cycles: number | null;
  cycle_scan_capped: boolean | null;
  captured_at: string;
};

type Change = {
  change_kind: string;
  entity_id: string | null;
  severity: number;
  severity_semantics: string;
  metric_semantics: string;
  previous_value: number | null;
  current_value: number | null;
  delta: number | null;
  evidence: Record<string, unknown>;
};

type CycleScan = {
  count: number;
  capped: boolean;
  maxDepth: number;
  maxCycles: number;
};

type TopologyState = {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  largestComponentSize: number;
  cycleScan: CycleScan;
  nodes: Map<string, NodeState>;
  quantitativeEdgeCoverage: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const [{ data: entities, error: entityError }, { data: relationships, error: relationshipError }] = await Promise.all([
    supabase.from("aicis_world_entities").select("id"),
    supabase
      .from("aicis_world_relationships")
      .select("id,source_entity_id,target_entity_id,relationship_type,strength,strength_semantics,confidence,confidence_semantics")
      .eq("status", "verified")
      .not("epistemic_status", "in", '("unverified","contradicted")'),
  ]);

  if (entityError || relationshipError) {
    console.error(JSON.stringify({
      level: "error",
      function: FN,
      message: "graph_load_failed",
      entity_error: entityError?.message,
      relationship_error: relationshipError?.message,
      timestamp: new Date().toISOString(),
    }));
    return json({ error: "Failed to load verified graph" }, 500);
  }

  const nodeIds = (entities ?? []).map((entity) => entity.id as string);
  const edges = (relationships ?? []) as Edge[];
  const current = computeTopology(nodeIds, edges);
  const topologyHash = await sha256Hex(JSON.stringify({
    nodes: [...nodeIds].sort(),
    edges: edges
      .map((edge) => [
        edge.source_entity_id,
        edge.target_entity_id,
        edge.relationship_type,
        edge.strength,
        edge.strength_semantics,
        edge.confidence,
        edge.confidence_semantics,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    scanner_semantics: {
      degree: DEGREE_SEMANTICS,
      influence: INFLUENCE_SEMANTICS,
      cycle: CYCLE_SEMANTICS,
    },
  }));

  const { data: existingByHash } = await supabase
    .from("aicis_graph_snapshots")
    .select("id,captured_at")
    .eq("topology_hash", topologyHash)
    .maybeSingle();

  if (existingByHash) {
    return json({
      success: true,
      unchanged: true,
      snapshot_id: existingByHash.id,
      captured_at: existingByHash.captured_at,
      degree_centrality_semantics: DEGREE_SEMANTICS,
      influence_semantics: INFLUENCE_SEMANTICS,
      cycle_count_semantics: CYCLE_SEMANTICS,
    });
  }

  const { data: previousSnapshotData } = await supabase
    .from("aicis_graph_snapshots")
    .select("id,node_count,edge_count,component_count,largest_component_size,cycle_count,cycle_count_semantics,cycle_scan_max_depth,cycle_scan_max_cycles,cycle_scan_capped,captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previousSnapshot = (previousSnapshotData ?? null) as PreviousSnapshot | null;

  const { data: snapshot, error: snapshotError } = await supabase
    .from("aicis_graph_snapshots")
    .insert({
      node_count: current.nodeCount,
      edge_count: current.edgeCount,
      component_count: current.componentCount,
      largest_component_size: current.largestComponentSize,
      cycle_count: current.cycleScan.count,
      cycle_count_semantics: CYCLE_SEMANTICS,
      cycle_scan_max_depth: current.cycleScan.maxDepth,
      cycle_scan_max_cycles: current.cycleScan.maxCycles,
      cycle_scan_capped: current.cycleScan.capped,
      topology_hash: topologyHash,
      metadata: {
        auth_via: via,
        verified_graph_only: true,
        degree_centrality_semantics: DEGREE_SEMANTICS,
        influence_semantics: INFLUENCE_SEMANTICS,
        quantitative_edge_coverage: current.quantitativeEdgeCoverage,
        cycle_count_semantics: CYCLE_SEMANTICS,
      },
    })
    .select("id,captured_at")
    .single();

  if (snapshotError || !snapshot) {
    return json({ error: "Failed to persist topology snapshot" }, 500);
  }

  const nodeRows = [...current.nodes.values()].map((node) => ({
    snapshot_id: snapshot.id,
    ...node,
  }));
  if (nodeRows.length > 0) {
    const { error } = await supabase.from("aicis_graph_node_snapshots").insert(nodeRows);
    if (error) return json({ error: "Failed to persist node topology" }, 500);
  }

  let changes: Change[] = [];
  if (previousSnapshot) {
    const { data: previousNodes, error: previousNodesError } = await supabase
      .from("aicis_graph_node_snapshots")
      .select("entity_id,degree_centrality,degree_centrality_semantics,influence,influence_semantics,influence_coverage,outgoing_edges,incoming_edges")
      .eq("snapshot_id", previousSnapshot.id);

    if (previousNodesError) return json({ error: "Failed to load prior topology" }, 500);
    changes = diffTopology(
      previousSnapshot,
      new Map(((previousNodes ?? []) as DbNodeSnapshot[]).map((node) => [node.entity_id, normalizeNode(node)])),
      current,
    );
  }

  if (changes.length > 0) {
    const { error: changeError } = await supabase.from("aicis_topology_changes").insert(
      changes.map((change) => ({
        previous_snapshot_id: previousSnapshot?.id ?? null,
        current_snapshot_id: snapshot.id,
        ...change,
      })),
    );
    if (changeError) return json({ error: "Failed to persist topology changes" }, 500);

    const highest = Math.max(...changes.map((change) => change.severity));
    const criticalChanges = changes.filter((change) => change.severity >= 0.8);
    await supabase.from("aicis_cognitive_events").insert({
      event_type: "topology.changed",
      epistemic_status: "derived",
      confidence: null,
      confidence_semantics: "not_applicable_deterministic_topology_detection",
      occurred_at: snapshot.captured_at,
      observed_at: snapshot.captured_at,
      time_semantics: "graph_snapshot_capture_time",
      producer: FN,
      payload: {
        snapshot_id: snapshot.id,
        previous_snapshot_id: previousSnapshot?.id ?? null,
        change_count: changes.length,
        highest_severity: highest,
        severity_semantics: SEVERITY_SEMANTICS,
        critical_changes: criticalChanges,
        kinds: countKinds(changes),
        quantitative_edge_coverage: current.quantitativeEdgeCoverage,
      },
      provenance: [{
        sourceId: `graph-snapshot:${snapshot.id}`,
        sourceType: "derived-verified-graph",
        observedAt: snapshot.captured_at,
        extractor: FN,
        extractorVersion: "2",
      }],
    });

    const feedbackEmergence = changes.find((change) => change.change_kind === "feedback.emerged");
    if (feedbackEmergence && previousSnapshot) {
      await supabase.from("aicis_cognitive_events").insert({
        event_type: "feedback_loop.detected",
        epistemic_status: "derived",
        confidence: null,
        confidence_semantics: "not_applicable_structural_cycle_candidate",
        occurred_at: snapshot.captured_at,
        observed_at: snapshot.captured_at,
        time_semantics: "graph_snapshot_capture_time",
        producer: FN,
        payload: {
          snapshot_id: snapshot.id,
          cycle_count: current.cycleScan.count,
          previous_cycle_count: previousSnapshot.cycle_count,
          cycle_count_semantics: CYCLE_SEMANTICS,
          cycle_scan_capped: current.cycleScan.capped,
          severity: feedbackEmergence.severity,
          severity_semantics: feedbackEmergence.severity_semantics,
          note: "Bounded structural cycle candidate only. A detected graph cycle is not evidence of a causal feedback loop without separate causal and temporal evidence.",
        },
        provenance: [{
          sourceId: `graph-snapshot:${snapshot.id}`,
          sourceType: "derived-verified-graph",
          observedAt: snapshot.captured_at,
          extractor: FN,
          extractorVersion: "2",
        }],
      });
    }
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_topology_scan",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Captured verified graph topology with ${changes.length} material changes`,
    metadata: {
      snapshot_id: snapshot.id,
      node_count: current.nodeCount,
      edge_count: current.edgeCount,
      change_count: changes.length,
      quantitative_edge_coverage: current.quantitativeEdgeCoverage,
      degree_centrality_semantics: DEGREE_SEMANTICS,
      influence_semantics: INFLUENCE_SEMANTICS,
      cycle_count_semantics: CYCLE_SEMANTICS,
      cycle_scan_capped: current.cycleScan.capped,
      severity_semantics: SEVERITY_SEMANTICS,
      auth_via: via,
    },
  });

  return json({
    success: true,
    unchanged: false,
    snapshot_id: snapshot.id,
    node_count: current.nodeCount,
    edge_count: current.edgeCount,
    component_count: current.componentCount,
    cycle_count: current.cycleScan.count,
    cycle_count_semantics: CYCLE_SEMANTICS,
    cycle_scan_capped: current.cycleScan.capped,
    quantitative_edge_coverage: current.quantitativeEdgeCoverage,
    degree_centrality_semantics: DEGREE_SEMANTICS,
    influence_semantics: INFLUENCE_SEMANTICS,
    severity_semantics: SEVERITY_SEMANTICS,
    changes,
  });
});

function computeTopology(nodeIds: string[], edges: Edge[]): TopologyState {
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of edges) {
    push(outgoing, edge.source_entity_id, edge);
    push(incoming, edge.target_entity_id, edge);
  }

  const denominator = Math.max(1, nodeIds.length - 1);
  const nodes = new Map<string, NodeState>();
  for (const id of nodeIds) {
    const neighbors = new Set<string>();
    for (const edge of outgoing.get(id) ?? []) neighbors.add(edge.target_entity_id);
    for (const edge of incoming.get(id) ?? []) neighbors.add(edge.source_entity_id);

    const outgoingEdges = outgoing.get(id) ?? [];
    const eligibleOutgoing = outgoingEdges.filter(hasExplicitEdgeQuantification);
    const influenceCoverage = outgoingEdges.length === 0 ? 1 : eligibleOutgoing.length / outgoingEdges.length;
    const influence = outgoingEdges.length === 0
      ? 0
      : influenceCoverage === 1
        ? eligibleOutgoing.reduce(
          (sum, edge) => sum + Number(edge.strength) * Number(edge.confidence),
          0,
        ) / eligibleOutgoing.length
        : null;
    const influenceSemantics = outgoingEdges.length === 0
      ? ZERO_OUTFLOW_SEMANTICS
      : influence === null
        ? UNKNOWN_INFLUENCE_SEMANTICS
        : INFLUENCE_SEMANTICS;

    nodes.set(id, {
      entity_id: id,
      degree_centrality: neighbors.size / denominator,
      degree_centrality_semantics: DEGREE_SEMANTICS,
      influence,
      influence_semantics: influenceSemantics,
      influence_coverage: influenceCoverage,
      outgoing_edges: outgoingEdges.length,
      incoming_edges: incoming.get(id)?.length ?? 0,
    });
  }

  const components = weakComponents(nodeIds, outgoing, incoming);
  const cycleScan = countDirectedCycles(nodeIds, outgoing, CYCLE_MAX_DEPTH, CYCLE_MAX_COUNT);
  const quantifiedEdgeCount = edges.filter(hasExplicitEdgeQuantification).length;
  return {
    nodeCount: nodeIds.length,
    edgeCount: edges.length,
    componentCount: components.length,
    largestComponentSize: components[0]?.length ?? 0,
    cycleScan,
    nodes,
    quantitativeEdgeCoverage: edges.length === 0 ? 1 : quantifiedEdgeCount / edges.length,
  };
}

function diffTopology(
  previousSnapshot: PreviousSnapshot,
  previousNodes: Map<string, NodeState>,
  current: TopologyState,
): Change[] {
  const changes: Change[] = [];
  const ids = new Set([...previousNodes.keys(), ...current.nodes.keys()]);

  for (const id of ids) {
    const before = previousNodes.get(id);
    const after = current.nodes.get(id);
    if (!before && after) {
      changes.push(change(
        "node.emerged",
        id,
        0.2 + 0.8 * after.degree_centrality,
        DEGREE_SEMANTICS,
        null,
        after.degree_centrality,
        null,
        { after, priority_formula: "0.2 + 0.8 * degree_centrality" },
      ));
      continue;
    }
    if (before && !after) {
      changes.push(change(
        "node.disappeared",
        id,
        0.2 + 0.8 * before.degree_centrality,
        before.degree_centrality_semantics,
        before.degree_centrality,
        null,
        null,
        { before, priority_formula: "0.2 + 0.8 * prior_degree_centrality" },
      ));
      continue;
    }
    if (!before || !after) continue;

    const centralityDelta = after.degree_centrality - before.degree_centrality;
    if (
      before.degree_centrality < CONNECTOR_THRESHOLD &&
      after.degree_centrality >= CONNECTOR_THRESHOLD &&
      centralityDelta >= CONNECTOR_DELTA_THRESHOLD
    ) {
      changes.push(change(
        "connector.emerged",
        id,
        0.4 + centralityDelta,
        DEGREE_SEMANTICS,
        before.degree_centrality,
        after.degree_centrality,
        centralityDelta,
        { before, after, connector_threshold: CONNECTOR_THRESHOLD, delta_threshold: CONNECTOR_DELTA_THRESHOLD },
      ));
    } else if (
      before.degree_centrality >= CONNECTOR_THRESHOLD &&
      after.degree_centrality < CONNECTOR_THRESHOLD &&
      -centralityDelta >= CONNECTOR_DELTA_THRESHOLD
    ) {
      changes.push(change(
        "connector.weakened",
        id,
        0.35 - centralityDelta,
        DEGREE_SEMANTICS,
        before.degree_centrality,
        after.degree_centrality,
        centralityDelta,
        { before, after, connector_threshold: CONNECTOR_THRESHOLD, delta_threshold: CONNECTOR_DELTA_THRESHOLD },
      ));
    }

    if (before.influence !== null && after.influence !== null) {
      const influenceDelta = after.influence - before.influence;
      if (influenceDelta >= INFLUENCE_DELTA_THRESHOLD) {
        changes.push(change(
          "influence.surge",
          id,
          0.3 + influenceDelta,
          INFLUENCE_SEMANTICS,
          before.influence,
          after.influence,
          influenceDelta,
          { before, after, delta_threshold: INFLUENCE_DELTA_THRESHOLD },
        ));
      } else if (-influenceDelta >= INFLUENCE_DELTA_THRESHOLD) {
        changes.push(change(
          "influence.drop",
          id,
          0.25 - influenceDelta,
          INFLUENCE_SEMANTICS,
          before.influence,
          after.influence,
          influenceDelta,
          { before, after, delta_threshold: INFLUENCE_DELTA_THRESHOLD },
        ));
      }
    }
  }

  if (current.componentCount < previousSnapshot.component_count) {
    changes.push(change(
      "cluster.merged",
      null,
      0.35,
      "deterministic_weak_component_count",
      previousSnapshot.component_count,
      current.componentCount,
      current.componentCount - previousSnapshot.component_count,
      {
        previous_largest_component_size: previousSnapshot.largest_component_size,
        current_largest_component_size: current.largestComponentSize,
        priority_formula: "fixed_operator_priority_0.35",
      },
    ));
  } else if (current.componentCount > previousSnapshot.component_count) {
    changes.push(change(
      "cluster.fragmented",
      null,
      0.35,
      "deterministic_weak_component_count",
      previousSnapshot.component_count,
      current.componentCount,
      current.componentCount - previousSnapshot.component_count,
      {
        previous_largest_component_size: previousSnapshot.largest_component_size,
        current_largest_component_size: current.largestComponentSize,
        priority_formula: "fixed_operator_priority_0.35",
      },
    ));
  }

  const cycleSemanticsComparable = previousSnapshot.cycle_count_semantics === CYCLE_SEMANTICS &&
    previousSnapshot.cycle_scan_max_depth === CYCLE_MAX_DEPTH &&
    previousSnapshot.cycle_scan_max_cycles === CYCLE_MAX_COUNT;
  if (cycleSemanticsComparable) {
    if (current.cycleScan.count > previousSnapshot.cycle_count) {
      changes.push(change(
        "feedback.emerged",
        null,
        0.55,
        CYCLE_SEMANTICS,
        previousSnapshot.cycle_count,
        current.cycleScan.count,
        current.cycleScan.count - previousSnapshot.cycle_count,
        {
          previous_scan_capped: previousSnapshot.cycle_scan_capped,
          current_scan_capped: current.cycleScan.capped,
          priority_formula: "fixed_operator_priority_0.55",
          causal_interpretation: "not_established",
        },
      ));
    } else if (current.cycleScan.count < previousSnapshot.cycle_count) {
      changes.push(change(
        "feedback.disappeared",
        null,
        0.35,
        CYCLE_SEMANTICS,
        previousSnapshot.cycle_count,
        current.cycleScan.count,
        current.cycleScan.count - previousSnapshot.cycle_count,
        {
          previous_scan_capped: previousSnapshot.cycle_scan_capped,
          current_scan_capped: current.cycleScan.capped,
          priority_formula: "fixed_operator_priority_0.35",
          causal_interpretation: "not_established",
        },
      ));
    }
  }

  return changes
    .filter((item) => item.severity >= 0.08)
    .sort((a, b) => b.severity - a.severity);
}

function weakComponents(
  nodeIds: string[],
  outgoing: Map<string, Edge[]>,
  incoming: Map<string, Edge[]>,
): string[][] {
  const remaining = new Set(nodeIds);
  const components: string[][] = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as string;
    const queue = [seed];
    const component: string[] = [];
    remaining.delete(seed);
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;
      component.push(id);
      const neighbors = new Set<string>();
      for (const edge of outgoing.get(id) ?? []) neighbors.add(edge.target_entity_id);
      for (const edge of incoming.get(id) ?? []) neighbors.add(edge.source_entity_id);
      for (const neighbor of neighbors) {
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.length - a.length);
}

function countDirectedCycles(
  nodeIds: string[],
  outgoing: Map<string, Edge[]>,
  maxDepth: number,
  maxCycles: number,
): CycleScan {
  const seen = new Set<string>();
  const visit = (start: string, current: string, path: string[], active: Set<string>) => {
    if (seen.size >= maxCycles || path.length > maxDepth) return;
    for (const edge of outgoing.get(current) ?? []) {
      const target = edge.target_entity_id;
      if (target === start && path.length >= 2) {
        seen.add(canonicalCycleKey(path));
        if (seen.size >= maxCycles) return;
        continue;
      }
      if (active.has(target)) continue;
      active.add(target);
      visit(start, target, [...path, target], active);
      active.delete(target);
      if (seen.size >= maxCycles) return;
    }
  };
  for (const id of nodeIds) {
    visit(id, id, [id], new Set([id]));
    if (seen.size >= maxCycles) break;
  }
  return {
    count: seen.size,
    capped: seen.size >= maxCycles,
    maxDepth,
    maxCycles,
  };
}

function canonicalCycleKey(cycle: string[]): string {
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join("→"));
  return rotations.sort()[0] ?? "";
}

function normalizeNode(node: DbNodeSnapshot): NodeState {
  return {
    entity_id: node.entity_id,
    degree_centrality: finiteNumberOr(node.degree_centrality, 0),
    degree_centrality_semantics: node.degree_centrality_semantics ?? "legacy_degree_centrality_semantics_unverified",
    influence: finiteNumberOrNull(node.influence),
    influence_semantics: node.influence_semantics ?? "legacy_influence_semantics_unverified",
    influence_coverage: finiteNumberOr(node.influence_coverage, 0),
    outgoing_edges: finiteNumberOr(node.outgoing_edges, 0),
    incoming_edges: finiteNumberOr(node.incoming_edges, 0),
  };
}

function change(
  kind: string,
  entityId: string | null,
  severity: number,
  metricSemantics: string,
  previous: number | null,
  current: number | null,
  delta: number | null,
  evidence: Record<string, unknown>,
): Change {
  return {
    change_kind: kind,
    entity_id: entityId,
    severity: clamp01(severity),
    severity_semantics: SEVERITY_SEMANTICS,
    metric_semantics: metricSemantics,
    previous_value: previous,
    current_value: current,
    delta,
    evidence,
  };
}

function countKinds(changes: Change[]) {
  return changes.reduce<Record<string, number>>((acc, item) => {
    acc[item.change_kind] = (acc[item.change_kind] ?? 0) + 1;
    return acc;
  }, {});
}

function hasExplicitEdgeQuantification(edge: Edge) {
  return isUnitInterval(edge.strength) &&
    isUnitInterval(edge.confidence) &&
    hasUsableNumericSemantics(edge.strength_semantics) &&
    hasUsableNumericSemantics(edge.confidence_semantics);
}

function hasUsableNumericSemantics(semantics: string | null) {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  return !normalized.includes("legacy") &&
    !normalized.includes("unknown") &&
    !normalized.includes("not_quantified") &&
    !normalized.includes("unverified");
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteNumberOr(value: number | string | null, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteNumberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function push(map: Map<string, Edge[]>, key: string, edge: Edge) {
  const values = map.get(key);
  if (values) values.push(edge);
  else map.set(key, [edge]);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}
