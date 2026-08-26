import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const h12 = new Date(now.getTime() - 12 * 3600000).toISOString();
    const h24 = new Date(now.getTime() - 24 * 3600000).toISOString();
    const h48 = new Date(now.getTime() - 48 * 3600000).toISOString();

    const issues: { type: string; severity: string; ids: string[]; count: number }[] = [];

    // 1. Accepted without execution owner after 12h
    const { data: noOwner } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("recommendation_accepted", true)
      .is("execution_owner", null)
      .lt("created_at", h12);
    if (noOwner?.length) {
      issues.push({ type: "missing_execution_owner", severity: "high", ids: noOwner.map(r => r.id), count: noOwner.length });
    }

    // 2. Accepted not started after SLA (24h default)
    const { data: notStarted } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("recommendation_accepted", true)
      .or("execution_status.is.null,execution_status.eq.not_started")
      .lt("created_at", h24);
    if (notStarted?.length) {
      issues.push({ type: "accepted_not_started_sla", severity: "high", ids: notStarted.map(r => r.id), count: notStarted.length });
    }

    // 3. Completed without outcome after 24h
    const { data: noOutcome } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("execution_status", "completed")
      .is("outcome_success", null)
      .lt("execution_completed_at", h24);
    if (noOutcome?.length) {
      issues.push({ type: "completed_no_outcome", severity: "critical", ids: noOutcome.map(r => r.id), count: noOutcome.length });
    }

    // 4. Failed without postmortem after 48h
    const { data: noPostmortem } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("outcome_success", false)
      .is("postmortem_note", null)
      .lt("outcome_timestamp", h48);
    if (noPostmortem?.length) {
      issues.push({ type: "failed_no_postmortem", severity: "high", ids: noPostmortem.map(r => r.id), count: noPostmortem.length });
    }

    // 5. Measured missing ROI
    const { data: noROI } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("evidence_type", "measured")
      .is("roi_estimate", null);
    if (noROI?.length) {
      issues.push({ type: "measured_missing_roi", severity: "medium", ids: noROI.map(r => r.id), count: noROI.length });
    }

    // 6. Missing reviewer
    const { data: noReviewer } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .is("assigned_reviewer", null)
      .eq("recommendation_accepted", true);
    if (noReviewer?.length) {
      issues.push({ type: "missing_reviewer", severity: "high", ids: noReviewer.map(r => r.id), count: noReviewer.length });
    }

    // Write enforcement log entries + alerts + silent failures for critical
    for (const issue of issues) {
      await supabase.from("evidence_enforcement_log").insert({
        scan_type: "scheduled_2h",
        issue_type: issue.type,
        severity: issue.severity,
        affected_count: issue.count,
        affected_ids: issue.ids,
      });

      if (issue.severity === "critical" || issue.severity === "high") {
        await supabase.from("alerts").insert({
          title: `Evidence gap: ${issue.type.replace(/_/g, " ")}`,
          message: `${issue.count} record(s) affected`,
          severity: issue.severity,
          division: "decision-engine",
        });

        if (issue.severity === "critical") {
          for (const id of issue.ids.slice(0, 10)) {
            await supabase.from("silent_failure_state").insert({
              failure_type: `enforcement:${issue.type}`,
              description: `Decision ${id} has ${issue.type.replace(/_/g, " ")}`,
              detected_at: now.toISOString(),
            }).onConflict("id").merge();
          }
        }
      }

      await supabase.from("audit_log").insert({
        action: `enforcement.${issue.type}`,
        resource_type: "evidence_enforcement_log",
        metadata: { count: issue.count, severity: issue.severity },
        severity: issue.severity === "critical" ? "error" : "warn",
      });
    }

    return new Response(JSON.stringify({ scanned: true, issues: issues.length, details: issues.map(i => ({ type: i.type, count: i.count })) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
