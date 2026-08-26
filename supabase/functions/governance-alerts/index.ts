import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function upsertFailureState(supabase: any, failureType: string, description: string, severity: string, isActive: boolean) {
  if (isActive) {
    const { data: existing } = await supabase
      .from("silent_failure_state")
      .select("id, resolved")
      .eq("failure_type", failureType)
      .maybeSingle();

    if (existing) {
      if (existing.resolved) {
        await supabase.from("silent_failure_state")
          .update({ resolved: false, detected_at: new Date().toISOString(), description, severity })
          .eq("id", existing.id);
      }
    } else {
      await supabase.from("silent_failure_state").insert({ failure_type: failureType, description, severity });
    }
  } else {
    await supabase.from("silent_failure_state")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("failure_type", failureType)
      .eq("resolved", false);
  }
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();
    const alerts: Array<{ title: string; message: string; severity: string; division: string }> = [];

    // 1. Overdue reviews
    const { data: overdue } = await supabase
      .from("decision_outcome_log")
      .select("id, signal_title")
      .or("review_status.is.null,review_status.eq.pending")
      .lt("review_due_at", now.toISOString())
      .not("review_due_at", "is", null);

    if (overdue && overdue.length > 0) {
      alerts.push({
        title: `${overdue.length} overdue decision review(s)`,
        message: `Decisions requiring review have exceeded their SLA deadline.`,
        severity: "high", division: "governance",
      });
    }

    // 2. Failed accepted without postmortem after 7d
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const { data: missingPM } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("recommendation_accepted", true)
      .eq("outcome_success", false)
      .is("postmortem_note", null)
      .lt("outcome_timestamp", sevenDaysAgo);

    if (missingPM && missingPM.length > 0) {
      alerts.push({
        title: `${missingPM.length} failed decision(s) missing postmortem`,
        message: `Accepted recommendations that failed have no postmortem note after 7+ days.`,
        severity: "high", division: "governance",
      });
    }

    // 3. Overridden without reason
    const { data: noNote } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("review_status", "overridden")
      .is("override_reason", null);

    if (noNote && noNote.length > 0) {
      alerts.push({
        title: `${noNote.length} overridden decision(s) without reason`,
        message: `Override reason was not recorded. Governance policy violation.`,
        severity: "critical", division: "governance",
      });
    }

    // 4. Critical dual approval pending
    const { data: dualPending } = await supabase
      .from("decision_outcome_log")
      .select("id")
      .eq("requires_dual_approval", true)
      .or("second_review_status.is.null,second_review_status.eq.pending")
      .or("review_status.is.null,review_status.eq.pending,review_status.eq.approved");

    if (dualPending && dualPending.length > 0) {
      alerts.push({
        title: `${dualPending.length} critical decision(s) awaiting dual approval`,
        message: `High-criticality decisions require dual approval.`,
        severity: "high", division: "governance",
      });
    }

    // 5. Missing execution owner >12h
    const twelveHoursAgo = new Date(now.getTime() - 12 * 3600000).toISOString();
    const { count: noOwnerCount } = await supabase
      .from("decision_outcome_log")
      .select("id", { count: "exact", head: true })
      .eq("recommendation_accepted", true)
      .is("execution_owner", null)
      .lt("created_at", twelveHoursAgo);

    if ((noOwnerCount ?? 0) > 0) {
      alerts.push({
        title: `${noOwnerCount} accepted decision(s) without execution owner for >12h`,
        message: "Execution ownership not assigned. Escalation required.",
        severity: "high", division: "governance",
      });
      await upsertFailureState(supabase, "missing_execution_owner",
        `${noOwnerCount} accepted decisions lack execution owner.`, "high", true);
    } else {
      await upsertFailureState(supabase, "missing_execution_owner", "", "high", false);
    }

    // 5a. Accepted but not started beyond SLA
    const { data: staleExec } = await supabase
      .from("decision_outcome_log")
      .select("id, signal_title, review_sla_hours, created_at")
      .eq("recommendation_accepted", true)
      .or("execution_status.is.null,execution_status.eq.not_started");

    const staleCount = (staleExec || []).filter((r: any) => {
      if (!r.created_at) return false;
      const sla = r.review_sla_hours || 24;
      const age = (now.getTime() - new Date(r.created_at).getTime()) / 3600000;
      return age > sla;
    }).length;

    if (staleCount > 0) {
      alerts.push({
        title: `${staleCount} accepted decision(s) not executed beyond SLA`,
        message: "Accepted recommendations have exceeded their SLA without execution starting.",
        severity: "high", division: "governance",
      });
      await upsertFailureState(supabase, "stale_execution_sla",
        `${staleCount} accepted decision(s) stalled beyond SLA.`, "high", true);
    } else {
      await upsertFailureState(supabase, "stale_execution_sla", "", "high", false);
    }

    // 5b. Completed execution without outcome review
    const { count: noOutcomeReview } = await supabase
      .from("decision_outcome_log")
      .select("id", { count: "exact", head: true })
      .eq("execution_status", "completed")
      .is("outcome_success", null);

    if ((noOutcomeReview ?? 0) > 0) {
      alerts.push({
        title: `${noOutcomeReview} completed execution(s) without outcome review`,
        message: "Execution completed but no outcome has been recorded.",
        severity: "medium", division: "governance",
      });
      await upsertFailureState(supabase, "missing_outcome_review",
        `${noOutcomeReview} completed execution(s) awaiting outcome.`, "medium", true);
    } else {
      await upsertFailureState(supabase, "missing_outcome_review", "", "medium", false);
    }

    // 6. No measured outcomes in 14d
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();
    const { count: recentMeasured } = await supabase
      .from("decision_outcome_log")
      .select("id", { count: "exact", head: true })
      .eq("evidence_type", "measured")
      .gte("outcome_timestamp", fourteenDaysAgo);

    const noMeasured14d = (recentMeasured ?? 0) === 0;
    await upsertFailureState(supabase, "no_measured_outcomes_14d",
      "No measured outcomes recorded in the last 14 days. Learning loop is stalled.", "high", noMeasured14d);
    if (noMeasured14d) {
      alerts.push({ title: "No measured outcomes in 14 days", message: "Learning loop stalled.", severity: "high", division: "decision-engine" });
    }

    // 7. No inference audit in 24h
    const oneDayAgo = new Date(now.getTime() - 24 * 3600000).toISOString();
    const { count: recentInference } = await supabase
      .from("decision_inference_audit")
      .select("id", { count: "exact", head: true })
      .gte("created_at", oneDayAgo);

    const noInference24h = (recentInference ?? 0) === 0;
    await upsertFailureState(supabase, "no_inference_audit_24h",
      "No inference audit records in 24 hours.", "medium", noInference24h);
    if (noInference24h) {
      alerts.push({ title: "No inference audit in 24h", message: "Inference pipeline inactive.", severity: "medium", division: "decision-engine" });
    }

    // 8. Weekly learning failed — check weekly_learning_logs first, then system_logs
    let learningFailed = false;
    const { data: lastLearning } = await supabase
      .from("weekly_learning_logs")
      .select("success")
      .order("run_started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLearning) {
      learningFailed = !lastLearning.success;
    } else {
      const { data: lastLearn } = await supabase
        .from("system_logs")
        .select("log_level")
        .eq("action", "weekly_decision_learning")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      learningFailed = lastLearn?.log_level === "error";
    }

    await upsertFailureState(supabase, "weekly_learning_failed",
      "Most recent weekly learning cycle encountered an error.", "high", learningFailed);
    if (learningFailed) {
      alerts.push({ title: "Weekly learning cycle failed", message: "Calibration may be stale.", severity: "high", division: "decision-engine" });
    }

    // 9. Active model stale (>30d)
    const { data: activeModel } = await supabase
      .from("decision_models")
      .select("version, last_calibrated_at, created_at")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    let modelStale = false;
    const modelDate = activeModel?.last_calibrated_at || activeModel?.created_at;
    if (modelDate) {
      const calAge = (now.getTime() - new Date(modelDate).getTime()) / 86400000;
      modelStale = calAge > 30;
    }
    await upsertFailureState(supabase, "stale_model_calibration",
      `Active model calibrated ${modelDate ? Math.round((now.getTime() - new Date(modelDate).getTime()) / 86400000) : "?"} days ago.`, "medium", modelStale);

    // 10. Trust score drop
    const { data: recentEvals } = await supabase
      .from("model_evaluations")
      .select("acceptance_rate, calibration_error")
      .order("evaluated_at", { ascending: false })
      .limit(2);

    let trustDrop = false;
    if (recentEvals && recentEvals.length >= 2) {
      const t = (e: any) => (1 - Math.min(e.calibration_error ?? 0.5, 1)) * 40 + (e.acceptance_rate ?? 0) * 30;
      trustDrop = t(recentEvals[1]) - t(recentEvals[0]) > 10;
    }
    await upsertFailureState(supabase, "trust_score_drop",
      "Trust score dropped >10 points between evaluations.", "high", trustDrop);

    // 11. Auto-flag model rollback if needed
    if (activeModel) {
      const { data: eval_ } = await supabase
        .from("model_evaluations")
        .select("improvement_over_heuristic, calibration_error")
        .eq("model_version", activeModel.version)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let needsRollback = false;
      let rollbackReason = "";

      if (eval_?.improvement_over_heuristic != null && eval_.improvement_over_heuristic < 0) {
        needsRollback = true;
        rollbackReason = `Underperforms heuristic by ${Math.abs(eval_.improvement_over_heuristic).toFixed(1)}%`;
      }

      if (trustDrop) {
        needsRollback = true;
        rollbackReason = rollbackReason ? rollbackReason + "; Trust score drop detected" : "Trust score drop >10 points";
      }

      if (needsRollback) {
        await supabase.from("decision_models")
          .update({ rollback_required: true, rollback_reason: rollbackReason })
          .eq("version", activeModel.version);
      }
    }

    // Write alerts (deduplicate 6h)
    let inserted = 0;
    for (const alert of alerts) {
      const sixHoursAgo = new Date(now.getTime() - 6 * 3600000).toISOString();
      const { data: existing } = await supabase
        .from("alerts").select("id")
        .eq("title", alert.title).eq("division", alert.division)
        .gte("created_at", sixHoursAgo).limit(1);

      if (!existing || existing.length === 0) {
        await supabase.from("alerts").insert(alert);
        inserted++;
      }
    }

    await supabase.from("system_logs").insert({
      action: "governance_alerts_scan",
      result: JSON.stringify({ alerts_detected: alerts.length, alerts_inserted: inserted }),
      log_level: "info", division: "governance",
    });

    return new Response(JSON.stringify({
      ok: true, alerts_detected: alerts.length, alerts_inserted: inserted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Governance alerts error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
