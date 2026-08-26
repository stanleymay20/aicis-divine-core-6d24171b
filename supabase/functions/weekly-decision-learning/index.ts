import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const runStartedAt = new Date().toISOString();

  try {
    console.log("Starting weekly decision learning cycle v2...");
    const results: Record<string, any> = {};

    // Step 1: Compute weekly stats from last 7 days
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recentOutcomes } = await supabase
      .from("decision_outcome_log")
      .select("outcome_success, impact_score, roi_estimate, recommendation_accepted, evidence_type")
      .gte("updated_at", weekAgo);

    const outcomes = recentOutcomes || [];
    const withOutcome = outcomes.filter(r => r.outcome_success !== null);
    const successRate = withOutcome.length > 0
      ? Math.round(withOutcome.filter(r => r.outcome_success).length / withOutcome.length * 100)
      : null;
    const avgROI = outcomes.filter(r => r.roi_estimate != null).length > 0
      ? Math.round(outcomes.filter(r => r.roi_estimate != null).reduce((s, r) => s + (r.roi_estimate || 0), 0) / outcomes.filter(r => r.roi_estimate != null).length * 10) / 10
      : null;
    const failedCount = withOutcome.filter(r => !r.outcome_success).length;

    results.weekly_stats = {
      total_outcomes: outcomes.length,
      with_outcome: withOutcome.length,
      success_rate: successRate,
      avg_roi: avgROI,
      failed_count: failedCount,
    };

    // Step 2: Run calibration
    let calibrationVersion: string | null = null;
    const { data: calData, error: calError } = await supabase.functions.invoke(
      "calibrate-decision-weights", { body: {} }
    );
    if (calError) {
      results.calibration = { error: calError.message };
    } else {
      results.calibration = { ok: true, version: calData?.version };
      calibrationVersion = calData?.version || null;
    }

    // Step 3: Run evaluation
    let evalResult: Record<string, any> | null = null;
    const { data: evalData, error: evalError } = await supabase.functions.invoke(
      "evaluate-decision-models", { body: {} }
    );
    if (evalError) {
      results.evaluation = { error: evalError.message };
    } else {
      evalResult = evalData?.evaluation || null;
      results.evaluation = {
        ok: true,
        improvement_over_heuristic: evalData?.evaluation?.improvement_over_heuristic,
        calibration_error: evalData?.evaluation?.calibration_error,
      };
    }

    // Step 4: Run governance alerts
    const { data: govData, error: govError } = await supabase.functions.invoke(
      "governance-alerts", { body: {} }
    );
    results.governance_alerts = govError
      ? { error: govError.message }
      : { ok: true, alerts_detected: govData?.alerts_detected || 0, alerts_inserted: govData?.alerts_inserted || 0 };

    const runFinishedAt = new Date().toISOString();
    const durationMs = new Date(runFinishedAt).getTime() - new Date(runStartedAt).getTime();

    // Step 5: Log to weekly_learning_logs table
    await supabase.from("weekly_learning_logs").insert({
      run_started_at: runStartedAt,
      run_finished_at: runFinishedAt,
      success: true,
      calibration_version: calibrationVersion,
      evaluation_result: evalResult ? {
        improvement_over_heuristic: evalResult.improvement_over_heuristic,
        calibration_error: evalResult.calibration_error,
      } : null,
      governance_alerts_triggered: results.governance_alerts?.alerts_inserted || 0,
      weekly_stats: results.weekly_stats,
      duration_ms: durationMs,
    });

    // Also log to system_logs for backward compatibility
    await supabase.from("system_logs").insert({
      action: "weekly_decision_learning",
      result: JSON.stringify({
        run_started_at: runStartedAt,
        run_finished_at: runFinishedAt,
        duration_ms: durationMs,
        weekly_stats: results.weekly_stats,
        calibration: results.calibration?.ok ? "success" : "error",
        calibration_version: calibrationVersion,
        evaluation: results.evaluation?.ok ? "success" : "error",
        governance_alerts: results.governance_alerts,
      }),
      log_level: "info",
      division: "decision-engine",
    });

    return new Response(JSON.stringify({ ok: true, results, run_started_at: runStartedAt, run_finished_at: runFinishedAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const runFinishedAt = new Date().toISOString();
    const durationMs = new Date(runFinishedAt).getTime() - new Date(runStartedAt).getTime();
    console.error("Weekly learning error:", error);
    await supabase.from("weekly_learning_logs").insert({
      run_started_at: runStartedAt,
      run_finished_at: runFinishedAt,
      success: false,
      error_message: error instanceof Error ? error.message : "Unknown",
      duration_ms: durationMs,
    });
    await supabase.from("system_logs").insert({
      action: "weekly_decision_learning",
      result: JSON.stringify({
        run_started_at: runStartedAt,
        run_finished_at: runFinishedAt,
        error: error instanceof Error ? error.message : "Unknown",
      }),
      log_level: "error",
      division: "decision-engine",
    });
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
