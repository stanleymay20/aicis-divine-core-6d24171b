import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const GRAPH_METHOD = "deterministic_operational_graph_v2_truth_floor";
const HEURISTIC_STRENGTH_SEMANTICS = "deterministic_rule_weight_v1_not_probability";
const PROPAGATION_SEMANTICS = "deterministic_decay_and_saturation_heuristic_v1";
const CONFIDENCE_SEMANTICS = "withheld_unmeasured";

type UnknownRecord = Record<string, unknown>;

type NodeUpsert = {
  organization_id: string;
  node_type: string;
  node_ref_id: string;
  canonical_key: string;
  title: string;
  summary?: string | null;
  operational_state?: string | null;
  status: string;
  operational_criticality: number | null;
  exposure_score: number | null;
  volatility_score: number | null;
  score_semantics: UnknownRecord;
  epistemic_status: string;
  metadata: UnknownRecord;
};

type EdgeUpsert = {
  organization_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  directionality: "directed";
  strength: number | null;
  confidence: number | null;
  propagation_weight: number | null;
  relationship_semantics: "governance-linked" | "inferred" | "temporal";
  validity_decay_score: number | null;
  last_validated_at: null;
  edge_staleness_state: "fresh" | "aging" | "stale" | "invalid" | null;
  max_propagation_influence: number | null;
  propagation_saturation_score: number | null;
  evidence_refs: UnknownRecord[];
  provenance: UnknownRecord;
  strength_semantics: string;
  confidence_semantics: string;
  propagation_semantics: string;
  relationship_verification_status: string;
  validation_semantics: string;
};

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function severityCriticality(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "critical") return 90;
  if (normalized === "high") return 70;
  if (normalized === "medium" || normalized === "moderate") return 50;
  if (normalized === "low") return 30;
  return null;
}

function sourceAgeDays(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 86_400_000);
}

function deterministicDecay(sourceTime: unknown): { decay: number | null; state: EdgeUpsert["edge_staleness_state"] } {
  const age = sourceAgeDays(sourceTime);
  if (age === null) return { decay: null, state: null };
  const decay = Math.max(0, Math.min(1, Math.exp(-age / 21)));
  const state = decay > 0.7 ? "fresh" : decay > 0.4 ? "aging" : decay > 0.15 ? "stale" : "invalid";
  return { decay, state };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({} as UnknownRecord));
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : null;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [narratives, pressures, interventions, decisions, advisories, signals, conflicts] = await Promise.all([
      supabase.from("intelligence_fusion_clusters")
        .select("id,title,canonical_summary,narrative_class,pressure_score,confidence_score,stability_score,volatility_score,status,generated_at,supporting_advisory_ids,supporting_intervention_ids,supporting_item_ids")
        .eq("organization_id", organizationId).eq("status", "active").limit(150),
      supabase.from("organizational_pressure_models")
        .select("id,snapshot_at,pressure_score,pressure_velocity,operational_pressure,strategic_pressure,supply_chain_pressure,execution_pressure,geopolitical_pressure,cyber_pressure,regulatory_pressure")
        .eq("organization_id", organizationId).order("snapshot_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("executive_interventions")
        .select("id,title,intervention_type,status,severity,created_at,source_type,source_id,decision_id,outcome_score")
        .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
      supabase.from("decision_ledger")
        .select("id,recommended_action,chosen_action,decision_status,confidence_at_decision,decision_type,decided_at,created_at,advisory_instance_id,linked_aicis_recommendation_id")
        .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
      supabase.from("advisory_instances")
        .select("id,title,action,confidence,status,priority,created_at,advisory_lane")
        .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(150),
      supabase.from("aicis_intelligence_items")
        .select("id,title,status,severity,urgency,ingested_at,occurred_at,domain,geography")
        .eq("organization_id", organizationId).order("ingested_at", { ascending: false }).limit(100),
      supabase.from("narrative_conflicts")
        .select("id,narrative_a_id,narrative_b_id,severity,status,detected_at")
        .eq("organization_id", organizationId).eq("status", "open").limit(50),
    ]);

    for (const result of [narratives, pressures, interventions, decisions, advisories, signals, conflicts]) {
      if (result.error) throw result.error;
    }

    const nodes: NodeUpsert[] = [];
    const pushNode = (node: NodeUpsert) => nodes.push(node);

    for (const raw of (narratives.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      pushNode({
        organization_id: organizationId,
        node_type: "narrative",
        node_ref_id: id,
        canonical_key: `narrative:${id}`,
        title: typeof raw.title === "string" ? raw.title : "Narrative",
        summary: typeof raw.canonical_summary === "string" ? raw.canonical_summary : null,
        operational_state: typeof raw.narrative_class === "string" ? raw.narrative_class : "active",
        status: "active",
        operational_criticality: null,
        exposure_score: null,
        volatility_score: null,
        score_semantics: {
          operational_criticality: "withheld_upstream_narrative_pressure_semantics_unverified",
          exposure_score: "unmeasured",
          volatility_score: "withheld_upstream_narrative_volatility_semantics_unverified",
        },
        epistemic_status: "source_record_observed_scores_unverified",
        metadata: {
          source_pressure_score: finiteNumber(raw.pressure_score),
          source_confidence_score: finiteNumber(raw.confidence_score),
          source_stability_score: finiteNumber(raw.stability_score),
          source_volatility_score: finiteNumber(raw.volatility_score),
          source_numeric_semantics: "legacy_upstream_fields_not_promoted_to_graph_truth",
          generated_at: raw.generated_at ?? null,
        },
      });
    }

    if (pressures.data) {
      const pressure = pressures.data as UnknownRecord;
      const dimensions: Array<[string, string]> = [
        ["operational_pressure", "operational"],
        ["strategic_pressure", "strategic"],
        ["supply_chain_pressure", "supply_chain"],
        ["execution_pressure", "execution"],
        ["geopolitical_pressure", "geopolitical"],
        ["cyber_pressure", "cyber"],
        ["regulatory_pressure", "regulatory"],
      ];
      for (const [column, key] of dimensions) {
        const rawValue = finiteNumber(pressure[column]);
        if (rawValue === null) continue;
        pushNode({
          organization_id: organizationId,
          node_type: "pressure",
          node_ref_id: `${String(pressure.id)}:${key}`,
          canonical_key: `pressure:${key}`,
          title: `${key.replaceAll("_", " ")} pressure`,
          operational_state: "active",
          status: "active",
          operational_criticality: null,
          exposure_score: null,
          volatility_score: null,
          score_semantics: {
            operational_criticality: "withheld_upstream_pressure_model_semantics_unverified",
            exposure_score: "unmeasured",
            volatility_score: "unmeasured",
          },
          epistemic_status: "upstream_pressure_value_preserved_not_promoted",
          metadata: {
            dimension: key,
            source_pressure_value: rawValue,
            source_pressure_velocity: finiteNumber(pressure.pressure_velocity),
            source_numeric_semantics: "legacy_upstream_fields_not_promoted_to_graph_truth",
            snapshot_at: pressure.snapshot_at ?? null,
          },
        });
      }
    }

    for (const raw of (interventions.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      const criticality = severityCriticality(raw.severity);
      pushNode({
        organization_id: organizationId,
        node_type: "intervention",
        node_ref_id: id,
        canonical_key: `intervention:${id}`,
        title: typeof raw.title === "string" ? raw.title : "Intervention",
        operational_state: typeof raw.status === "string" ? raw.status : null,
        status: raw.status === "resolved" ? "retired" : "active",
        operational_criticality: criticality,
        exposure_score: null,
        volatility_score: null,
        score_semantics: {
          operational_criticality: criticality === null ? "unmeasured" : "deterministic_severity_bucket_v1_not_probability",
          exposure_score: "unmeasured",
          volatility_score: "unmeasured",
        },
        epistemic_status: criticality === null ? "partial_observation" : "deterministic_heuristic_labeled",
        metadata: {
          intervention_type: raw.intervention_type ?? null,
          source_type: raw.source_type ?? null,
          source_id: raw.source_id ?? null,
          decision_id: raw.decision_id ?? null,
          outcome_score: raw.outcome_score ?? null,
          created_at: raw.created_at ?? null,
        },
      });
    }

    for (const raw of (decisions.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      const status = typeof raw.decision_status === "string" ? raw.decision_status : "open";
      pushNode({
        organization_id: organizationId,
        node_type: "decision",
        node_ref_id: id,
        canonical_key: `decision:${id}`,
        title: typeof raw.recommended_action === "string" ? raw.recommended_action : typeof raw.chosen_action === "string" ? raw.chosen_action : "Decision",
        operational_state: status,
        status: ["executed", "rejected", "completed"].includes(status) ? "retired" : "active",
        operational_criticality: null,
        exposure_score: null,
        volatility_score: null,
        score_semantics: { operational_criticality: "unmeasured", exposure_score: "unmeasured", volatility_score: "unmeasured" },
        epistemic_status: "observed_decision_record",
        metadata: {
          decision_type: raw.decision_type ?? null,
          source_confidence_at_decision: finiteNumber(raw.confidence_at_decision),
          source_confidence_semantics: "preserved_source_field_not_promoted_to_graph_criticality",
          advisory_instance_id: raw.advisory_instance_id ?? null,
          linked_aicis_recommendation_id: raw.linked_aicis_recommendation_id ?? null,
          created_at: raw.created_at ?? raw.decided_at ?? null,
        },
      });
    }

    for (const raw of (advisories.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      const status = typeof raw.status === "string" ? raw.status : "active";
      pushNode({
        organization_id: organizationId,
        node_type: "advisory",
        node_ref_id: id,
        canonical_key: `advisory:${id}`,
        title: typeof raw.title === "string" ? raw.title : typeof raw.action === "string" ? raw.action : "Advisory",
        operational_state: status,
        status: ["expired", "resolved"].includes(status) ? "retired" : "active",
        operational_criticality: null,
        exposure_score: null,
        volatility_score: null,
        score_semantics: { operational_criticality: "unmeasured", exposure_score: "unmeasured", volatility_score: "unmeasured" },
        epistemic_status: "observed_advisory_record",
        metadata: {
          source_confidence: finiteNumber(raw.confidence),
          source_confidence_semantics: "preserved_source_field_not_promoted_to_graph_criticality",
          priority: raw.priority ?? null,
          lane: raw.advisory_lane ?? null,
          created_at: raw.created_at ?? null,
        },
      });
    }

    for (const raw of (signals.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      const criticality = severityCriticality(raw.severity);
      pushNode({
        organization_id: organizationId,
        node_type: "signal",
        node_ref_id: id,
        canonical_key: `signal:${id}`,
        title: typeof raw.title === "string" ? raw.title : "Signal",
        operational_state: typeof raw.status === "string" ? raw.status : "active",
        status: "active",
        operational_criticality: criticality,
        exposure_score: null,
        volatility_score: null,
        score_semantics: {
          operational_criticality: criticality === null ? "unmeasured" : "deterministic_severity_bucket_v1_not_probability",
          exposure_score: "unmeasured",
          volatility_score: "unmeasured",
        },
        epistemic_status: criticality === null ? "partial_observation" : "deterministic_heuristic_labeled",
        metadata: {
          domain: raw.domain ?? null,
          geography: raw.geography ?? null,
          observed_at: raw.occurred_at ?? raw.ingested_at ?? null,
        },
      });
    }

    if (nodes.length > 0) {
      const { error } = await supabase.from("operational_graph_nodes")
        .upsert(nodes, { onConflict: "organization_id,node_type,canonical_key" });
      if (error) throw error;
    }

    const { data: nodeRows, error: nodeLookupError } = await supabase
      .from("operational_graph_nodes").select("id,canonical_key").eq("organization_id", organizationId);
    if (nodeLookupError) throw nodeLookupError;
    const keyToId = new Map<string, string>();
    for (const row of (nodeRows ?? []) as Array<{ id: string; canonical_key: string }>) keyToId.set(row.canonical_key, row.id);

    const edges: EdgeUpsert[] = [];
    const pushEdge = (
      sourceKey: string,
      targetKey: string,
      edgeType: string,
      strength: number,
      relationshipSemantics: EdgeUpsert["relationship_semantics"],
      verificationStatus: string,
      evidenceRefs: UnknownRecord[],
      sourceTime: unknown,
    ) => {
      const sourceNodeId = keyToId.get(sourceKey);
      const targetNodeId = keyToId.get(targetKey);
      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
      const { decay, state } = deterministicDecay(sourceTime);
      edges.push({
        organization_id: organizationId,
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
        edge_type: edgeType,
        directionality: "directed",
        strength,
        confidence: null,
        propagation_weight: decay === null ? null : Math.max(0, Math.min(1, strength * decay)),
        relationship_semantics: relationshipSemantics,
        validity_decay_score: decay,
        last_validated_at: null,
        edge_staleness_state: state,
        max_propagation_influence: 0.7,
        propagation_saturation_score: 0,
        evidence_refs: evidenceRefs,
        provenance: {
          engine: "build-operational-graph",
          method: GRAPH_METHOD,
          derived_at: new Date().toISOString(),
          causal_inference: false,
        },
        strength_semantics: HEURISTIC_STRENGTH_SEMANTICS,
        confidence_semantics: CONFIDENCE_SEMANTICS,
        propagation_semantics: PROPAGATION_SEMANTICS,
        relationship_verification_status: verificationStatus,
        validation_semantics: "not_independently_validated_derivation_time_is_not_validation_time",
      });
    };

    for (const raw of (narratives.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      const generatedAt = raw.generated_at;
      for (const interventionId of stringArray(raw.supporting_intervention_ids)) {
        pushEdge(`intervention:${interventionId}`, `narrative:${id}`, "mitigates", 0.7, "governance-linked", "explicit_reference_unverified_effect", [{ kind: "narrative_support_reference", narrative_id: id, intervention_id: interventionId }], generatedAt);
      }
      for (const advisoryId of stringArray(raw.supporting_advisory_ids)) {
        pushEdge(`advisory:${advisoryId}`, `narrative:${id}`, "informed_by", 0.6, "governance-linked", "explicit_reference", [{ kind: "narrative_support_reference", narrative_id: id, advisory_id: advisoryId }], generatedAt);
      }
      for (const signalId of stringArray(raw.supporting_item_ids)) {
        pushEdge(`signal:${signalId}`, `narrative:${id}`, "derived_from", 0.55, "governance-linked", "explicit_reference", [{ kind: "narrative_support_reference", narrative_id: id, signal_id: signalId }], generatedAt);
      }

      const narrativeClass = typeof raw.narrative_class === "string" ? raw.narrative_class.toLowerCase() : "";
      const pressureKey = narrativeClass.includes("supply") ? "pressure:supply_chain"
        : narrativeClass.includes("exec") ? "pressure:execution"
        : narrativeClass.includes("strategy") || narrativeClass.includes("market") ? "pressure:strategic"
        : narrativeClass.includes("regul") || narrativeClass.includes("compli") ? "pressure:regulatory"
        : narrativeClass.includes("cyber") ? "pressure:cyber"
        : "pressure:operational";
      pushEdge(pressureKey, `narrative:${id}`, "pressure_propagates_to", 0.5, "inferred", "deterministic_class_match_unverified", [{ kind: "deterministic_class_match", narrative_id: id, narrative_class: narrativeClass }], generatedAt);
    }

    for (const raw of (decisions.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      const createdAt = raw.created_at ?? raw.decided_at;
      if (typeof raw.advisory_instance_id === "string") {
        pushEdge(`advisory:${raw.advisory_instance_id}`, `decision:${id}`, "informed_by", 0.7, "governance-linked", "explicit_reference", [{ kind: "decision_advisory_reference", decision_id: id, advisory_id: raw.advisory_instance_id }], createdAt);
      }
      if (typeof raw.linked_aicis_recommendation_id === "string") {
        pushEdge(`signal:${raw.linked_aicis_recommendation_id}`, `decision:${id}`, "informed_by", 0.65, "governance-linked", "explicit_reference", [{ kind: "decision_signal_reference", decision_id: id, signal_id: raw.linked_aicis_recommendation_id }], createdAt);
      }
    }

    for (const raw of (interventions.data ?? []) as UnknownRecord[]) {
      const id = String(raw.id);
      if (raw.source_type === "decision" && typeof raw.source_id === "string") {
        pushEdge(`decision:${raw.source_id}`, `intervention:${id}`, "informed_by", 0.7, "governance-linked", "explicit_reference", [{ kind: "intervention_source_reference", intervention_id: id, decision_id: raw.source_id }], raw.created_at);
      }
      if (raw.source_type === "narrative" && typeof raw.source_id === "string") {
        pushEdge(`narrative:${raw.source_id}`, `intervention:${id}`, "informed_by", 0.6, "governance-linked", "explicit_reference", [{ kind: "intervention_source_reference", intervention_id: id, narrative_id: raw.source_id }], raw.created_at);
      }
    }

    for (const raw of (conflicts.data ?? []) as UnknownRecord[]) {
      if (typeof raw.narrative_a_id !== "string" || typeof raw.narrative_b_id !== "string") continue;
      pushEdge(`narrative:${raw.narrative_a_id}`, `narrative:${raw.narrative_b_id}`, "contradicts", 0.7, "governance-linked", "explicit_conflict_record", [{ kind: "narrative_conflict_record", conflict_id: raw.id, severity: raw.severity ?? null }], raw.detected_at);
    }

    const outgoingCounts = new Map<string, number>();
    for (const edge of edges) outgoingCounts.set(edge.source_node_id, (outgoingCounts.get(edge.source_node_id) ?? 0) + 1);
    for (const edge of edges) {
      const outgoing = outgoingCounts.get(edge.source_node_id) ?? 0;
      const saturation = Math.min(1, Math.max(0, (outgoing - 8) / 20));
      edge.propagation_saturation_score = saturation;
      if (edge.propagation_weight !== null) edge.propagation_weight = Math.max(0, Math.min(1, edge.propagation_weight * (1 - saturation * 0.5)));
    }

    if (edges.length > 0) {
      const { error } = await supabase.from("operational_graph_edges")
        .upsert(edges, { onConflict: "organization_id,source_node_id,target_node_id,edge_type" });
      if (error) throw error;
    }

    const { error: governanceError } = await supabase.from("graph_governance_events").insert({
      organization_id: organizationId,
      event_type: "generated",
      new_state: {
        nodes_upserted: nodes.length,
        edges_upserted: edges.length,
        method: GRAPH_METHOD,
        analytical_confidence: null,
        causal_inference: false,
      },
      reason: "Deterministic operational graph build with explicit epistemic semantics.",
      actor: "build-operational-graph",
    });
    if (governanceError) throw governanceError;

    return new Response(JSON.stringify({
      ok: true,
      nodes_upserted: nodes.length,
      edges_upserted: edges.length,
      graph_method: GRAPH_METHOD,
      analytical_confidence: null,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      causal_inference: false,
      authenticated_via: callerAuth.via,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("build-operational-graph error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
