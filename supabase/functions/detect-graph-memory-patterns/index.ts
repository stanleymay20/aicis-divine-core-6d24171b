import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const LOOKBACK_DAYS = 30;
const MIN_RECURRENCE = 3;
const PATTERN_METHOD = "traversal_type_and_node_type_path_v1";
const PATTERN_SEMANTICS = "deterministic_recurrence_pattern_not_causal_inference";
const EFFECTIVENESS_SEMANTICS = "unmeasured_no_outcome_linkage";

const TRAVERSAL_TO_PATTERN: Record<string, string> = {
  escalation_chain: "recurring_escalation",
  intervention_impact: "recurring_intervention_chain",
  narrative_conflict: "recurring_narrative_conflict",
  governance_lineage: "recurring_governance_breakdown",
  dependency_concentration: "recurring_dependency_risk",
  root_cause: "recurring_failure",
};

type TraversalPathEntry = {
  node_type?: unknown;
};

type TraversalRow = {
  traversal_type: string;
  traversal_path: unknown;
  created_at: string;
};

type PatternAccumulator = {
  patternType: string;
  nodeTypes: string[];
  count: number;
  lastSeenAt: string;
};

function nodeTypePath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return "unknown";
    const nodeType = (entry as TraversalPathEntry).node_type;
    return typeof nodeType === "string" && nodeType.trim() ? nodeType : "unknown";
  });
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
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : null;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("graph_traversal_cache")
      .select("traversal_type,traversal_path,created_at")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .limit(1000);
    if (error) throw error;

    const groups = new Map<string, PatternAccumulator>();
    for (const row of (data ?? []) as TraversalRow[]) {
      const patternType = TRAVERSAL_TO_PATTERN[row.traversal_type];
      if (!patternType) continue;

      const nodeTypes = nodeTypePath(row.traversal_path);
      if (nodeTypes.length < 2) continue;

      const signature = `${row.traversal_type}|${nodeTypes.join(">")}`;
      const existing = groups.get(signature);
      if (!existing) {
        groups.set(signature, {
          patternType,
          nodeTypes,
          count: 1,
          lastSeenAt: row.created_at,
        });
        continue;
      }

      existing.count += 1;
      if (row.created_at > existing.lastSeenAt) existing.lastSeenAt = row.created_at;
    }

    const patterns = [...groups.entries()]
      .filter(([, group]) => group.count >= MIN_RECURRENCE)
      .map(([signature, group]) => ({
        organization_id: organizationId,
        pattern_type: group.patternType,
        pattern_signature: signature,
        recurring_path: group.nodeTypes,
        recurrence_frequency: group.count,
        last_seen_at: group.lastSeenAt,
        historical_effectiveness: null,
        historical_outcomes: [],
        effectiveness_semantics: EFFECTIVENESS_SEMANTICS,
        pattern_semantics: PATTERN_SEMANTICS,
      }));

    if (patterns.length > 0) {
      const { error: upsertError } = await supabase
        .from("graph_memory_patterns")
        .upsert(patterns, { onConflict: "organization_id,pattern_type,pattern_signature" });
      if (upsertError) throw upsertError;

      const { error: eventError } = await supabase.from("graph_governance_events").insert({
        organization_id: organizationId,
        event_type: "memory_pattern_detected",
        new_state: {
          patterns_upserted: patterns.length,
          method: PATTERN_METHOD,
          recurrence_threshold: MIN_RECURRENCE,
          pattern_semantics: PATTERN_SEMANTICS,
          historical_effectiveness: null,
          effectiveness_semantics: EFFECTIVENESS_SEMANTICS,
        },
        reason: "Recurring traversal pattern scan; recurrence is observed from cached traversals and does not imply causal effectiveness.",
        actor: "detect-graph-memory-patterns",
      });
      if (eventError) throw eventError;
    }

    const { error: observabilityError } = await supabase.from("graph_observability").upsert(
      {
        organization_id: organizationId,
        day: new Date().toISOString().slice(0, 10),
        recurring_pattern_count: patterns.length,
      },
      { onConflict: "organization_id,day" },
    );
    if (observabilityError) throw observabilityError;

    return new Response(JSON.stringify({
      ok: true,
      patterns_upserted: patterns.length,
      pattern_method: PATTERN_METHOD,
      pattern_semantics: PATTERN_SEMANTICS,
      recurrence_threshold: MIN_RECURRENCE,
      historical_effectiveness: null,
      effectiveness_semantics: EFFECTIVENESS_SEMANTICS,
      causal_inference: false,
      authenticated_via: callerAuth.via,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("detect-graph-memory-patterns error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
