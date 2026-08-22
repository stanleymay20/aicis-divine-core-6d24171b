import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-topology-scan";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Edge = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  confidence: number;
};

type NodeState = {
  entity_id: string;
  degree_centrality: number;
  influence: number;
  outgoing_edges: number;
  incoming_edges: number;
};

type Change = {
  change_kind: string;
  entity_id: string | null;
  severity: number;
  previous_value: number | null;
  current_value: number | null;
  delta: number | null;
  evidence: Record<string, unknown>;
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
      .select("id,source_entity_id,target_entity_id,relationship_type,strength,confidence")
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
      .map((edge) => [edge.source_entity_id, edge.target_entity_id, edge.relationship_type, edge.strength, edge.confidence])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
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
    });
  }

  const { data: previousSnapshot } = await supabase
    .from("aicis_graph_snapshots")
    .select("id,node_count,edge_count,component_count,largest_component_size,cycle_count,captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: snapshot, error: snapshotError } = await supabase
    .from("aicis_graph_snapshots")
    .insert({
      node_count: current.nodeCount,
      edge_count: current.edgeCount,
      component_count: current.componentCount,
      largest_component_size: current.largestComponentSize,
      cycle_count: current.cycleCount,
      topology_hash: topologyHash,
      metadata: {
        auth_via: via,
        verified_graph_only: true,
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
      .select("entity_id,degree_centrality,influence,outgoing_edges,incoming_edges")
      .eq("snapshot_id", previousSnapshot.id);

    if (previousNodesError) return json({ error: "Failed to load prior topology" }, 500);
    changes = diffTopology(
      previousSnapshot,
      new Map((previousNodes ?? []).map((node) => [node.entity_id as string, normalizeNode(node)])),
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
      confidence: 1,
      occurred_at: snapshot.captured_at,
      producer: FN,
      payload: {
        snapshot_id: snapshot.id,
        previous_snapshot_id: previousSnapshot?.id ?? null,
        change_count: changes.length,
        highest_severity: highest,
        critical_changes: criticalChanges,
        kinds: countKinds(changes),
      },
      provenance: [{
        sourceId: `graph-snapshot:${snapshot.id}`,
        sourceType: "derived-verified-graph",
        observedAt: snapshot.captured_at,
        extractor: FN,
        extractorVersion: "1",
      }],
    });

    const feedbackEmergence = changes.find((change) => change.change_kind === "feedback.emerged");
    if (feedbackEmergence) {
      await supabase.from("aicis_cognitive_events").insert({
        event_type: "feedback_loop.detected",
        epistemic_status: "derived",
        confidence: clamp01(feedbackEmergence.severity),
        occurred_at: snapshot.captured_at,
        producer: FN,
        payload: {
          snapshot_id: snapshot.id,
          cycle_count: current.cycleCount,
          previous_cycle_count: previousSnapshot?.cycle_count ?? 0,
          note: "Structural cycle candidate only; causal interpretation requires separate evidence.",
        },
        provenance: [{
          sourceId: `graph-snapshot:${snapshot.id}`,
          sourceType: "derived-verified-graph",
          observedAt: snapshot.captured_at,
          extractor: FN,
          extractorVersion: "1",
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
    cycle_count: current.cycleCount,
    changes,
  });
});

function computeTopology(nodeIds: string[], edges: Edge[]) {
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of edges) {
    push(outgoing, edge.source_entity_id, edge);
    push(incoming, edge.target_entity_id, edge);
  }

  const denominator = Math.max(1, nodeIds.length - 1);
  const rawInfluence = new Map<string, number>();
  let maxInfluence = 0;
  for (const id of nodeIds) {
    const score = (outgoing.get(id) ?? []).reduce(
      (sum, edge) => sum + clamp01(edge.strength ?? edge.confidence) * clamp01(edge.confidence),
      0,
    );
    rawInfluence.set(id, score);
    maxInfluence = Math.max(maxInfluence, score);
  }

  const nodes = new Map<string, NodeState>();
  for (const id of nodeIds) {
    const neighbors = new Set<string>();
    for (const edge of outgoing.get(id) ?? []) neighbors.add(edge.target_entity_id);
    for (const edge of incoming.get(id) ?? []) neighbors.add(edge.source_entity_id);
    nodes.set(id, {
      entity_id: id,
      degree_centrality: neighbors.size / denominator,
      influence: maxInfluence > 0 ? (rawInfluence.get(id) ?? 0) / maxInfluence : 0,
      outgoing_edges: outgoing.get(id)?.length ?? 0,
      incoming_edges: incoming.get(id)?.length ?? 0,
    });
  }

  const components = weakComponents(nodeIds, outgoing, incoming);
  return {
    nodeCount: nodeIds.length,
    edgeCount: edges.length,
    componentCount: components.length,
    largestComponentSize: components[0]?.length ?? 0,
    cycleCount: countDirectedCycles(nodeIds, outgoing, 8, 500),
    nodes,
  };
}

function diffTopology(previousSnapshot: any, previousNodes: Map<string, NodeState>, current: ReturnType<typeof computeTopology>): Change[] {
  const changes: Change[] = [];
  const connectorThreshold = 0.35;
  const ids = new Set([...previousNodes.keys(), ...current.nodes.keys()]);

  for (const id of ids) {
    const before = previousNodes.get(id);
    const after = current.nodes.get(id);
    if (!before && after) {
      changes.push(change("node.emerged", id, 0.2 + 0.4 * after.degree_centrality + 0.4 * after.influence, null, after.degree_centrality, null, { after }));
      continue;
    }
    if (before && !after) {
      changes.push(change("node.disappeared", id, 0.2 + 0.4 * before.degree_centrality + 0.4 * before.influence, before.degree_centrality, null, null, { before }));
      continue;
    }
    if (!before || !after) continue;

    const centralityDelta = after.degree_centrality - before.degree_centrality;
    const influenceDelta = after.influence - before.influence;
    if (before.degree_centrality < connectorThreshold && after.degree_centrality >= connectorThreshold && centralityDelta >= 0.15) {
      changes.push(change("connector.emerged", id, 0.4 + centralityDelta, before.degree_centrality, after.degree_centrality, centralityDelta, { before, after }));
    } else if (before.degree_centrality >= connectorThreshold && after.degree_centrality < connectorThreshold && -centralityDelta >= 0.15) {
      changes.push(change("connector.weakened", id, 0.35 - centralityDelta, before.degree_centrality, after.degree_centrality, centralityDelta, { before, after }));
    }
    if (influenceDelta >= 0.2) {
      changes.push(change("influence.surge", id, 0.3 + influenceDelta, before.influence, after.influence, influenceDelta, { before, after }));
    } else if (-influenceDelta >= 0.2) {
      changes.push(change("influence.drop", id, 0.25 - influenceDelta, before.influence, after.influence, influenceDelta, { before, after }));
    }
  }

  if (current.componentCount < previousSnapshot.component_count) {
    changes.push(change("cluster.merged", null, 0.35, previousSnapshot.component_count, current.componentCount, current.componentCount - previousSnapshot.component_count, {
      previous_largest_component_size: previousSnapshot.largest_component_size,
      current_largest_component_size: current.largestComponentSize,
    }));
  } else if (current.componentCount > previousSnapshot.component_count) {
    changes.push(change("cluster.fragmented", null, 0.35, previousSnapshot.component_count, current.componentCount, current.componentCount - previousSnapshot.component_count, {
      previous_largest_component_size: previousSnapshot.largest_component_size,
      current_largest_component_size: current.largestComponentSize,
    }));
  }

  if (current.cycleCount > previousSnapshot.cycle_count) {
    changes.push(change("feedback.emerged", null, 0.55, previousSnapshot.cycle_count, current.cycleCount, current.cycleCount - previousSnapshot.cycle_count, {}));
  } else if (current.cycleCount < previousSnapshot.cycle_count) {
    changes.push(change("feedback.disappeared", null, 0.35, previousSnapshot.cycle_count, current.cycleCount, current.cycleCount - previousSnapshot.cycle_count, {}));
  }

  return changes.filter((item) => item.severity >= 0.08).sort((a, b) => b.severity - a.severity);
}

function weakComponents(nodeIds: string[], outgoing: Map<string, Edge[]>, incoming: Map<string, Edge[]>): string[][] {
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

function countDirectedCycles(nodeIds: string[], outgoing: Map<string, Edge[]>, maxDepth: number, maxCycles: number): number {
  const seen = new Set<string>();
  const visit = (start: string, current: string, path: string[], active: Set<string>) => {
    if (seen.size >= maxCycles || path.length > maxDepth) return;
    for (const edge of outgoing.get(current) ?? []) {
      const target = edge.target_entity_id;
      if (target === start && path.length >= 2) {
        seen.add(canonicalCycleKey(path));
        continue;
      }
      if (active.has(target)) continue;
      active.add(target);
      visit(start, target, [...path, target], active);
      active.delete(target);
    }
  };
  for (const id of nodeIds) {
    visit(id, id, [id], new Set([id]));
    if (seen.size >= maxCycles) break;
  }
  return seen.size;
}

function canonicalCycleKey(cycle: string[]): string {
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join("→"));
  return rotations.sort()[0] ?? "";
}

function normalizeNode(node: any): NodeState {
  return {
    entity_id: node.entity_id,
    degree_centrality: Number(node.degree_centrality ?? 0),
    influence: Number(node.influence ?? 0),
    outgoing_edges: Number(node.outgoing_edges ?? 0),
    incoming_edges: Number(node.incoming_edges ?? 0),
  };
}

function change(kind: string, entityId: string | null, severity: number, previous: number | null, current: number | null, delta: number | null, evidence: Record<string, unknown>): Change {
  return {
    change_kind: kind,
    entity_id: entityId,
    severity: clamp01(severity),
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

function push(map: Map<string, Edge[]>, key: string, edge: Edge) {
  const values = map.get(key);
  if (values) values.push(edge);
  else map.set(key, [edge]);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
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
