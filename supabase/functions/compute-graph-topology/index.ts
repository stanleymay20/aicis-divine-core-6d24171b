// Deterministic graph topology v2 — truth-floor hardened.
//
// This worker computes structural graph heuristics. Its outputs are not calibrated
// probabilities, causal proof, evidence confidence, historical accuracy, or measured
// reliability unless a dedicated governed field explicitly says otherwise.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

type NodeRow = {
  id: string;
  operational_criticality: number | null;
  exposure_score: number | null;
  volatility_score: number | null;
};

type EdgeRow = {
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  strength: number | null;
  propagation_weight: number | null;
  validity_decay_score: number | null;
  relationship_semantics: string | null;
};

type WeightedEdge = { to: number; w: number; type: string; sem: string | null };
type IncomingEdge = { from: number; w: number; type: string; sem: string | null };

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, "x-cron-secret");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const started = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : null;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: rawNodes, error: nodeError }, { data: rawEdges, error: edgeError }] = await Promise.all([
      supabase
        .from("operational_graph_nodes")
        .select("id,operational_criticality,exposure_score,volatility_score,status")
        .eq("organization_id", organizationId)
        .eq("status", "active"),
      supabase
        .from("operational_graph_edges")
        .select("source_node_id,target_node_id,edge_type,strength,propagation_weight,validity_decay_score,relationship_semantics")
        .eq("organization_id", organizationId),
    ]);
    if (nodeError) throw nodeError;
    if (edgeError) throw edgeError;

    const nodes = (rawNodes ?? []) as NodeRow[];
    const edges = (rawEdges ?? []) as EdgeRow[];
    if (!nodes.length) {
      return new Response(JSON.stringify({ ok: true, nodes_scored: 0, epistemic_contract: "truth_floor_v2" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const index = new Map(nodes.map((node, i) => [node.id, i]));
    const out: WeightedEdge[][] = Array.from({ length: nodes.length }, () => []);
    const incoming: IncomingEdge[][] = Array.from({ length: nodes.length }, () => []);
    let withheldEdges = 0;

    for (const edge of edges) {
      const source = index.get(edge.source_node_id);
      const target = index.get(edge.target_node_id);
      if (source === undefined || target === undefined) continue;

      const strength = finite(edge.strength);
      if (strength === null) {
        withheldEdges += 1;
        continue;
      }
      const propagation = finite(edge.propagation_weight);
      const decay = finite(edge.validity_decay_score);
      const weight = strength * (propagation ?? 1) * (decay ?? 1);
      out[source].push({ to: target, w: weight, type: edge.edge_type, sem: edge.relationship_semantics });
      incoming[target].push({ from: source, w: weight, type: edge.edge_type, sem: edge.relationship_semantics });
    }

    const damping = 0.85;
    let pageRank = new Array(nodes.length).fill(1 / nodes.length);
    for (let iteration = 0; iteration < 15; iteration += 1) {
      const next = new Array(nodes.length).fill((1 - damping) / nodes.length);
      for (let i = 0; i < nodes.length; i += 1) {
        const total = out[i].reduce((sum, edge) => sum + edge.w, 0);
        if (total === 0) {
          for (let j = 0; j < nodes.length; j += 1) next[j] += (damping * pageRank[i]) / nodes.length;
        } else {
          for (const edge of out[i]) next[edge.to] += (damping * pageRank[i] * edge.w) / total;
        }
      }
      pageRank = next;
    }
    const maxPageRank = Math.max(...pageRank, 1e-9);

    const blastRadius = (start: number) => {
      const visited = new Set<number>([start]);
      let frontier = [start];
      let weightedCriticality = 0;
      let depth = 0;
      let unknownCriticality = 0;
      for (let d = 1; d <= 3 && frontier.length; d += 1) {
        const next: number[] = [];
        for (const current of frontier) {
          for (const edge of out[current]) {
            if (visited.has(edge.to)) continue;
            visited.add(edge.to);
            const criticality = finite(nodes[edge.to].operational_criticality);
            if (criticality === null) unknownCriticality += 1;
            else weightedCriticality += criticality * edge.w * Math.pow(0.7, d - 1);
            next.push(edge.to);
            depth = d;
            if (next.length >= 50) break;
          }
          if (next.length >= 50) break;
        }
        frontier = next;
      }
      return {
        score: unknownCriticality === 0 ? Math.min(100, weightedCriticality / 5) : null,
        depth,
        touched: visited.size - 1,
        unknown_criticality_nodes: unknownCriticality,
      };
    };

    const payload = nodes.map((node, i) => {
      const centrality = clamp((pageRank[i] / maxPageRank) * 100);
      const escalationEdges = incoming[i].filter((edge) => edge.type === "escalates" || edge.type === "pressure_propagates_to");
      const escalationDensity = clamp(escalationEdges.reduce((sum, edge) => sum + edge.w * 100, 0) / 2);
      const conflictDensity = clamp(incoming[i].filter((edge) => edge.type === "contradicts").length * 25);
      const dependencyCount = out[i].filter((edge) => edge.type === "caused_by").length + incoming[i].filter((edge) => edge.type === "depends_on").length;
      const dependencyScore = clamp(dependencyCount * 15);
      const outgoingWeight = out[i].reduce((sum, edge) => sum + edge.w, 0);
      const propagationRisk = clamp(centrality * 0.4 + outgoingWeight * 20);
      const blast = blastRadius(i);

      return {
        node_id: node.id,
        organization_id: organizationId,
        centrality_score: centrality,
        exposure_score: finite(node.exposure_score),
        volatility_score: finite(node.volatility_score),
        operational_criticality: finite(node.operational_criticality),
        decision_dependency_score: dependencyScore,
        propagation_risk: propagationRisk,
        escalation_density: escalationDensity,
        conflict_density: conflictDensity,
        blast_radius_score: blast.score,
        blast_radius_breakdown: { depth: blast.depth, touched: blast.touched, unknown_criticality_nodes: blast.unknown_criticality_nodes },
        evidence_confidence: null,
        relationship_stability: null,
        cross_source_consistency: null,
        topology_reliability: null,
        historical_accuracy: null,
        scoring_breakdown: { pagerank: pageRank[i], incoming_edges_used: incoming[i].length, outgoing_edges_used: out[i].length },
        score_semantics: {
          centrality_score: "deterministic_weighted_pagerank_heuristic_not_probability",
          decision_dependency_score: "deterministic_edge_count_heuristic_not_probability",
          propagation_risk: "deterministic_topology_heuristic_not_calibrated_risk_probability",
          escalation_density: "deterministic_weighted_edge_heuristic",
          conflict_density: "deterministic_edge_count_heuristic",
          blast_radius_score: blast.score === null ? "withheld_missing_required_criticality" : "deterministic_depth_limited_graph_heuristic",
          evidence_confidence: "withheld_no_governed_evidence_confidence_model",
          relationship_stability: "withheld_no_measured_stability_window",
          cross_source_consistency: "withheld_relationship_semantics_are_not_independent_sources",
          topology_reliability: "withheld_no_calibrated_reliability_model",
          historical_accuracy: "withheld_no_outcome_linkage",
        },
        epistemic_status: "deterministic_structural_heuristics_with_unmeasured_fields_withheld",
        computed_at: new Date().toISOString(),
      };
    });

    const { error: upsertError } = await supabase.from("graph_topology_scores").upsert(payload, { onConflict: "node_id" });
    if (upsertError) throw upsertError;

    const events: Record<string, unknown>[] = [];
    for (const score of payload) {
      const checks: Array<[string, number | null, number]> = [
        ["propagation_risk_heuristic", score.propagation_risk, 80],
        ["blast_radius_heuristic", score.blast_radius_score, 75],
        ["conflict_density_heuristic", score.conflict_density, 75],
      ];
      for (const [kind, value, threshold] of checks) {
        if (value !== null && value >= threshold) {
          events.push({
            organization_id: organizationId,
            node_id: score.node_id,
            event_type: "heuristic_threshold_breached",
            escalation_threshold_breached: false,
            threshold_kind: kind,
            threshold_value: value,
            reason: `Deterministic ${kind} score >= ${threshold}; requires governed interpretation`,
            actor: "compute-graph-topology",
            new_state: { heuristic_score: value, score_semantics: "deterministic_not_calibrated_probability" },
            prior_state: {},
          });
        }
      }
    }
    if (events.length) {
      const { error } = await supabase.from("graph_governance_events").insert(events);
      if (error) throw error;
    }

    const durationMs = Date.now() - started;
    const { error: observationError } = await supabase.from("graph_observability").upsert(
      { organization_id: organizationId, day: new Date().toISOString().slice(0, 10), topology_compute_ms: durationMs },
      { onConflict: "organization_id,day" },
    );
    if (observationError) throw observationError;

    return new Response(JSON.stringify({
      ok: true,
      nodes_scored: payload.length,
      heuristic_threshold_events: events.length,
      edges_withheld_missing_strength: withheldEdges,
      duration_ms: durationMs,
      epistemic_contract: "truth_floor_v2",
      calibrated_probability: null,
      analytical_confidence: null,
      authenticated_via: auth.via,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("compute-graph-topology error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
