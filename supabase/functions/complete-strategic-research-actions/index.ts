import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { normalizeResearchEvidenceRefs } from "../_shared/strategic-research-lifecycle-v1.mjs";
import { buildResearchCompletionResolution } from "../_shared/strategic-research-completion-v1.mjs";

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
    const strategicAuditHash = String(body.strategic_audit_hash || "").trim().toLowerCase();
    const completionKind = String(body.completion_kind || "").trim();
    const sourceCandidateId = body.source_candidate_id ? String(body.source_candidate_id).trim() : null;
    const evidenceRefs = normalizeResearchEvidenceRefs(body.evidence_refs);
    const completion = buildResearchCompletionResolution(completionKind, asRecord(body.metadata));

    if (!/^[a-f0-9]{64}$/.test(strategicAuditHash)) {
      return json({ ok: false, error: "valid strategic_audit_hash is required" }, 400);
    }
    if (!completion.ok || !completion.action_kind) {
      return json({
        ok: false,
        code: completion.reason,
        error: "Unsupported strategic research completion kind",
      }, 400);
    }
    if (evidenceRefs.length === 0) {
      return json({
        ok: false,
        code: "attributable_evidence_required",
        error: "Automatic research completion requires at least one attributable evidence reference.",
      }, 400);
    }

    const { data: candidates, error: selectError } = await sb
      .from("strategic_research_runs_v1")
      .select("id,action_id,action_kind,lifecycle_status,evidence_refs,resolution,source_candidate_id")
      .eq("user_id", user.id)
      .eq("strategic_audit_hash", strategicAuditHash)
      .eq("action_kind", completion.action_kind)
      .in("lifecycle_status", ["pending", "in_progress", "blocked"]);

    if (selectError) throw selectError;

    const matchingCandidates = (candidates ?? []).filter((run) =>
      !sourceCandidateId ||
      !run.source_candidate_id ||
      run.source_candidate_id === sourceCandidateId
    );

    const updatedRuns = [];
    for (const run of matchingCandidates) {
      const currentRefs = Array.isArray(run.evidence_refs) ? run.evidence_refs : [];
      const byKey = new Map<string, unknown>();

      for (const ref of [...currentRefs, ...evidenceRefs]) {
        const item = asRecord(ref);
        const key = [
          String(item.source_id || ""),
          String(item.observed_at || ""),
          String(item.sha256 || item.citation_id || ""),
        ].join("|");
        if (key !== "||") byKey.set(key, ref);
      }

      const resolution = {
        ...asRecord(run.resolution),
        ...completion.resolution,
      };

      const { data: updated, error: updateError } = await sb
        .from("strategic_research_runs_v1")
        .update({
          lifecycle_status: "resolved",
          evidence_refs: [...byKey.values()],
          resolution,
        })
        .eq("id", run.id)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (updateError) throw updateError;
      updatedRuns.push(updated);
    }

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "complete_strategic_research_actions",
      result: updatedRuns.length ? "research_blockers_resolved" : "no_matching_open_research_tasks",
      log_level: "info",
      metadata: {
        strategic_audit_hash: strategicAuditHash,
        completion_kind: completionKind,
        action_kind: completion.action_kind,
        source_candidate_id: sourceCandidateId,
        evidence_ref_count: evidenceRefs.length,
        resolved_run_count: updatedRuns.length,
      },
    });

    return json({
      ok: true,
      strategic_audit_hash: strategicAuditHash,
      completion_kind: completionKind,
      action_kind: completion.action_kind,
      resolved_run_count: updatedRuns.length,
      runs: updatedRuns,
      scope_notice: "Only open research tasks matching the audited blocker kind were resolved. Evidence satisfaction does not imply transaction profitability or execution approval.",
    });
  } catch (error) {
    console.error("complete-strategic-research-actions failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Strategic research completion failed",
    }, 500);
  }
});
