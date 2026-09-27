import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  normalizeResearchEvidenceRefs,
  normalizeResearchResolution,
  validateStrategicResearchTransition,
} from "../_shared/strategic-research-lifecycle-v1.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const runId = String(body.run_id || "").trim();
    const targetStatus = String(body.lifecycle_status || "").trim();

    if (!runId) return json({ ok: false, error: "run_id is required" }, 400);
    if (!targetStatus) return json({ ok: false, error: "lifecycle_status is required" }, 400);

    const { data: current, error: currentError } = await sb
      .from("strategic_research_runs_v1")
      .select("id,user_id,lifecycle_status,evidence_refs,resolution,action_id,action_kind,title,strategic_audit_hash")
      .eq("id", runId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return json({ ok: false, error: "Research run not found" }, 404);

    const transition = validateStrategicResearchTransition(current.lifecycle_status, targetStatus);
    if (!transition.ok) {
      return json({
        ok: false,
        code: "invalid_research_lifecycle_transition",
        error: transition.reason,
        current_status: current.lifecycle_status,
        requested_status: targetStatus,
      }, 409);
    }

    const incomingEvidence = normalizeResearchEvidenceRefs(body.evidence_refs);
    const currentEvidence = Array.isArray(current.evidence_refs) ? current.evidence_refs : [];
    const evidenceByKey = new Map<string, unknown>();

    for (const ref of [...currentEvidence, ...incomingEvidence]) {
      const item = asRecord(ref);
      const key = [
        String(item.source_id || ""),
        String(item.observed_at || ""),
        String(item.sha256 || item.citation_id || ""),
      ].join("|");
      if (key !== "||") evidenceByKey.set(key, ref);
    }

    const nextEvidence = [...evidenceByKey.values()];
    const resolution = {
      ...asRecord(current.resolution),
      ...normalizeResearchResolution(body.resolution),
    };

    if (targetStatus === "resolved" && nextEvidence.length === 0 && Object.keys(resolution).length === 0) {
      return json({
        ok: false,
        code: "resolution_evidence_required",
        error: "Resolved research tasks require attributable evidence or an explicit resolution disposition.",
      }, 400);
    }

    const { data: updated, error: updateError } = await sb
      .from("strategic_research_runs_v1")
      .update({
        lifecycle_status: targetStatus,
        evidence_refs: nextEvidence,
        resolution,
      })
      .eq("id", runId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "update_strategic_research_run",
      result: "research_run_updated",
      log_level: "info",
      metadata: {
        run_id: runId,
        action_id: current.action_id,
        action_kind: current.action_kind,
        strategic_audit_hash: current.strategic_audit_hash,
        from_status: current.lifecycle_status,
        to_status: targetStatus,
        evidence_ref_count: nextEvidence.length,
      },
    });

    return json({
      ok: true,
      run: updated,
      transition,
      mutation_boundary: "Immutable planner/action snapshot fields were not modified.",
    });
  } catch (error) {
    console.error("update-strategic-research-run failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Strategic research run update failed",
    }, 500);
  }
});
