// Graph attention compression v2 — truth-floor hardened.
//
// This worker ranks deterministic topology heuristics for bounded human attention.
// It does not establish real-world escalation, calibrated risk, causal truth,
// confidence, or reliability.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BUDGETS: Record<string, number> = { executive: 5, operations: 12, governance: 8, board: 5 };
const EXEC_BUDGET = 5;
const MIN_PRIORITY_COVERAGE = 0.6;
const MIN_PRIORITY_SCORE = 25;

type TopologyScore = {
  node_id: string;
  blast_radius_score: number | null;
  propagation_risk: number | null;
  operational_criticality: number | null;
  escalation_density: number | null;
  conflict_density: number | null;
  score_semantics: Record<string, unknown> | null;
  epistemic_status: string | null;
};

type GraphNode = {
  id: string;
  node_type: string;
  title: string;
  summary: string | null;
  operational_state: string | null;
};

type Candidate = {
  score: TopologyScore;
  node: GraphNode;
  priority: number;
  coverage: number;
};

type HeuristicCategory =
  | "Heuristic escalation-pattern attention"
  | "Heuristic conflict-pattern attention"
  | "Heuristic propagation attention"
  | "Heuristic dependency attention"
  | "Heuristic criticality attention";

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const priorityScore = (score: TopologyScore): { value: number | null; coverage: number } => {
  const components: Array<{ value: number | null; weight: number }> = [
    { value: finite(score.blast_radius_score), weight: 0.35 },
    { value: finite(score.propagation_risk), weight: 0.25 },
    { value: finite(score.operational_criticality), weight: 0.20 },
    { value: finite(score.escalation_density), weight: 0.10 },
    { value: finite(score.conflict_density), weight: 0.10 },
  ];
  const available = components.filter((component) => component.value !== null);
  const coverage = available.reduce((sum, component) => sum + component.weight, 0);
  if (coverage < MIN_PRIORITY_COVERAGE) return { value: null, coverage };
  const weighted = available.reduce((sum, component) => sum + (component.value ?? 0) * component.weight, 0);
  return { value: Math.max(0, Math.min(100, weighted / coverage)), coverage };
};

const classifyCategory = (score: TopologyScore, node: GraphNode): HeuristicCategory => {
  const escalation = finite(score.escalation_density);
  const conflict = finite(score.conflict_density);
  const propagation = finite(score.propagation_risk);
  const blast = finite(score.blast_radius_score);
  const criticality = finite(score.operational_criticality);

  if (escalation !== null && escalation >= 60) return "Heuristic escalation-pattern attention";
  if (conflict !== null && conflict >= 50) return "Heuristic conflict-pattern attention";
  if (propagation !== null && blast !== null && propagation >= 65 && blast >= 60) {
    return "Heuristic propagation attention";
  }
  if ((node.node_type === "intervention" || node.node_type === "dependency") && propagation !== null && propagation >= 50) {
    return "Heuristic dependency attention";
  }
  return criticality !== null && criticality >= 55
    ? "Heuristic criticality attention"
    : "Heuristic propagation attention";
};

const metricText = (label: string, value: number | null) =>
  value === null ? `${label} unknown` : `${label} heuristic ${value.toFixed(0)}`;

Deno.serve(async (req) => {
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

    const [{ data: rawScores, error: scoreError }, { data: rawNodes, error: nodeError }] = await Promise.all([
      supabase
        .from("graph_topology_scores")
        .select("node_id,blast_radius_score,propagation_risk,operational_criticality,escalation_density,conflict_density,score_semantics,epistemic_status")
        .eq("organization_id", organizationId)
        .limit(100),
      supabase
        .from("operational_graph_nodes")
        .select("id,node_type,title,summary,operational_state")
        .eq("organization_id", organizationId),
    ]);
    if (scoreError) throw scoreError;
    if (nodeError) throw nodeError;

    const scores = (rawScores ?? []) as TopologyScore[];
    const nodes = (rawNodes ?? []) as GraphNode[];
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    if (!scores.length) {
      return new Response(JSON.stringify({ ok: true, views_generated: 0, epistemic_contract: "attention_truth_floor_v2" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates: Candidate[] = [];
    let withheldForCoverage = 0;
    for (const score of scores) {
      const node = nodeMap.get(score.node_id);
      if (!node) continue;
      const ranked = priorityScore(score);
      if (ranked.value === null) {
        withheldForCoverage += 1;
        continue;
      }
      candidates.push({ score, node, priority: ranked.value, coverage: ranked.coverage });
    }
    candidates.sort((a, b) => b.priority - a.priority);

    const seen = new Set<string>();
    const deduped: Candidate[] = [];
    const suppressions: Record<string, unknown>[] = [];
    for (const candidate of candidates) {
      const signature = `${candidate.node.node_type}:${candidate.node.title.slice(0, 32).toLowerCase()}`;
      if (seen.has(signature)) {
        suppressions.push({
          organization_id: organizationId,
          node_id: candidate.node.id,
          event_type: "suppressed",
          reason: "Duplicate deterministic attention signature",
          actor: "compress-graph-attention",
          new_state: { signature, suppression_semantics: "deduplication_not_evidence_rejection" },
          prior_state: {},
        });
        continue;
      }
      seen.add(signature);
      deduped.push(candidate);
    }

    const filtered = deduped.filter((candidate) => {
      if (candidate.priority >= MIN_PRIORITY_SCORE) return true;
      suppressions.push({
        organization_id: organizationId,
        node_id: candidate.node.id,
        event_type: "suppressed",
        reason: `Deterministic attention priority ${candidate.priority.toFixed(1)} < ${MIN_PRIORITY_SCORE}`,
        actor: "compress-graph-attention",
        new_state: {
          priority_score: candidate.priority,
          priority_semantics: "deterministic_attention_ranking_not_probability_or_verified_severity",
        },
        prior_state: {},
      });
      return false;
    });

    const inserts: Record<string, unknown>[] = [];
    for (const persona of Object.keys(BUDGETS)) {
      const budget = BUDGETS[persona];
      const isExecutiveSurface = persona === "executive" || persona === "board";
      let slice = filtered.slice(0, budget);

      if (isExecutiveSurface) {
        const byCategory = new Map<HeuristicCategory, Candidate>();
        for (const candidate of filtered) {
          const category = classifyCategory(candidate.score, candidate.node);
          if (!byCategory.has(category)) byCategory.set(category, candidate);
          if (byCategory.size >= EXEC_BUDGET) break;
        }
        slice = [...byCategory.values()].slice(0, EXEC_BUDGET);
      }

      slice.forEach((candidate, index) => {
        const category = isExecutiveSurface ? classifyCategory(candidate.score, candidate.node) : null;
        const levelBudget = isExecutiveSurface ? EXEC_BUDGET : budget;
        const abstractionLevel = index < Math.ceil(levelBudget / 3)
          ? 1
          : index < Math.ceil((levelBudget * 2) / 3)
            ? 2
            : 3;

        const summary = [
          `${candidate.node.node_type.toUpperCase()} attention candidate`,
          metricText("blast radius", finite(candidate.score.blast_radius_score)),
          metricText("propagation", finite(candidate.score.propagation_risk)),
          metricText("criticality", finite(candidate.score.operational_criticality)),
        ].join(" — ");

        inserts.push({
          organization_id: organizationId,
          persona,
          abstraction_level: abstractionLevel,
          title: category ? `${category} — ${candidate.node.title}` : `Heuristic attention — ${candidate.node.title}`,
          compressed_summary: `${summary}. These are deterministic topology heuristics requiring human/governed interpretation.`,
          priority_score: candidate.priority,
          priority_semantics: "deterministic_weighted_attention_ranking_not_probability_confidence_or_verified_severity",
          epistemic_status: "heuristic_attention_candidate_not_verified_operational_fact",
          supporting_nodes: [{
            node_id: candidate.node.id,
            type: candidate.node.node_type,
            heuristic_category: category,
            input_weight_coverage: candidate.coverage,
            topology_epistemic_status: candidate.score.epistemic_status,
            topology_score_semantics: candidate.score.score_semantics,
          }],
          supporting_edges: [],
        });
      });
    }

    const { error: deleteError } = await supabase
      .from("graph_attention_views")
      .delete()
      .eq("organization_id", organizationId)
      .gt("expires_at", new Date().toISOString());
    if (deleteError) throw deleteError;

    if (inserts.length) {
      const { error } = await supabase.from("graph_attention_views").insert(inserts);
      if (error) throw error;
    }
    if (suppressions.length) {
      const { error } = await supabase.from("graph_governance_events").insert(suppressions);
      if (error) throw error;
    }

    const compressionRatio = candidates.length > 0 ? inserts.length / candidates.length : 0;
    const { error: observationError } = await supabase.from("graph_observability").upsert(
      { organization_id: organizationId, day: new Date().toISOString().slice(0, 10), compression_ratio: compressionRatio },
      { onConflict: "organization_id,day" },
    );
    if (observationError) throw observationError;

    return new Response(JSON.stringify({
      ok: true,
      views_generated: inserts.length,
      suppressed: suppressions.length,
      candidates_withheld_for_insufficient_metric_coverage: withheldForCoverage,
      compression_ratio: compressionRatio,
      duration_ms: Date.now() - started,
      epistemic_contract: "attention_truth_floor_v2",
      calibrated_probability: null,
      analytical_confidence: null,
      authenticated_via: auth.via,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("compress-graph-attention error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
