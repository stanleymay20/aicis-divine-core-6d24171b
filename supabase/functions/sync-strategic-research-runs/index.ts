import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { hashStrategicSnapshot } from "../_shared/strategic-audit-v1.mjs";

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

function validHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
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
    const strategicAuditHash = String(body.strategic_audit_hash || "").trim().toLowerCase();
    const plan = asRecord(body.research_plan);
    const plannerVersion = String(plan.planner_version || "").trim();
    const workflowVersion = String(plan.workflow_version || "").trim() || null;
    const actions = Array.isArray(plan.actions) ? plan.actions.map(asRecord).slice(0, 100) : [];

    if (!validHash(strategicAuditHash)) {
      return json({ ok: false, error: "valid strategic_audit_hash is required" }, 400);
    }
    if (!plannerVersion) return json({ ok: false, error: "research_plan.planner_version is required" }, 400);
    if (actions.length === 0) {
      return json({
        ok: true,
        synced: 0,
        existing: 0,
        runs: [],
        notice: "Research plan contained no actions, so nothing was persisted.",
      });
    }

    const runs: unknown[] = [];
    let inserted = 0;
    let existingCount = 0;

    for (const action of actions) {
      const actionId = String(action.id || "").trim();
      const actionKind = String(action.kind || "").trim();
      const title = String(action.title || "").trim();
      const priority = String(action.priority || "").trim();
      const sourceCandidateId = action.source_candidate_id
        ? String(action.source_candidate_id).trim()
        : null;
      const workflow = asRecord(action.workflow);
      const workflowStatus = workflow.status ? String(workflow.status).trim() : null;

      if (!actionId || !actionKind || !title || !["blocking", "high", "normal"].includes(priority)) {
        return json({
          ok: false,
          error: "research plan contains an invalid action snapshot",
          action_id: actionId || null,
        }, 400);
      }

      const snapshotAudit = await hashStrategicSnapshot(action);

      const { data: current, error: currentError } = await sb
        .from("strategic_research_runs_v1")
        .select("id,lifecycle_status,action_snapshot_hash,evidence_refs,resolution,created_at,updated_at")
        .eq("user_id", user.id)
        .eq("strategic_audit_hash", strategicAuditHash)
        .eq("action_id", actionId)
        .maybeSingle();

      if (currentError) throw currentError;

      if (current) {
        if (current.action_snapshot_hash !== snapshotAudit.hash) {
          return json({
            ok: false,
            code: "immutable_action_snapshot_conflict",
            error: "An existing research task for this strategic audit/action id has a different immutable snapshot.",
            action_id: actionId,
            existing_snapshot_hash: current.action_snapshot_hash,
            supplied_snapshot_hash: snapshotAudit.hash,
          }, 409);
        }
        existingCount += 1;
        runs.push({
          ...current,
          action_id: actionId,
          action_kind: actionKind,
          title,
          priority,
          source_candidate_id: sourceCandidateId,
          workflow_status: workflowStatus,
        });
        continue;
      }

      const { data: created, error: insertError } = await sb
        .from("strategic_research_runs_v1")
        .insert({
          user_id: user.id,
          strategic_audit_hash: strategicAuditHash,
          planner_version: plannerVersion,
          workflow_version: workflowVersion,
          action_id: actionId,
          action_kind: actionKind,
          title,
          priority,
          workflow_status: workflowStatus,
          lifecycle_status: "pending",
          source_candidate_id: sourceCandidateId,
          action_snapshot: action,
          action_snapshot_hash: snapshotAudit.hash,
          evidence_refs: [],
          resolution: {},
        })
        .select("id,lifecycle_status,action_snapshot_hash,evidence_refs,resolution,created_at,updated_at")
        .single();

      if (insertError) throw insertError;
      inserted += 1;
      runs.push({
        ...created,
        action_id: actionId,
        action_kind: actionKind,
        title,
        priority,
        source_candidate_id: sourceCandidateId,
        workflow_status: workflowStatus,
      });
    }

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "sync_strategic_research_runs",
      result: "research_runs_synchronized",
      log_level: "info",
      metadata: {
        strategic_audit_hash: strategicAuditHash,
        planner_version: plannerVersion,
        workflow_version: workflowVersion,
        action_count: actions.length,
        inserted,
        existing: existingCount,
      },
    });

    return json({
      ok: true,
      strategic_audit_hash: strategicAuditHash,
      planner_version: plannerVersion,
      workflow_version: workflowVersion,
      synced: inserted,
      existing: existingCount,
      runs,
      mutation_boundary: "Existing immutable action snapshots and lifecycle states were preserved.",
    });
  } catch (error) {
    console.error("sync-strategic-research-runs failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Strategic research synchronization failed",
    }, 500);
  }
});
