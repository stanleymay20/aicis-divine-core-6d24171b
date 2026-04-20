/**
 * pipeline-watchdog — runs every 15 minutes.
 *
 * 1. Calls find_stalled_pipelines() → identifies pipelines past 2× their interval.
 * 2. Auto-restarts them by invoking their target edge function.
 * 3. Logs SLO violations + critical alerts on repeated failures.
 * 4. Runs run_canary_probe() to verify end-to-end propagation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const result: Record<string, any> = { started_at: new Date().toISOString() };

  try {
    // 1. Find stalled pipelines
    const { data: stalled, error: stallErr } = await supabase.rpc("find_stalled_pipelines");
    if (stallErr) throw stallErr;

    result.stalled_count = stalled?.length ?? 0;
    result.restarts = [];

    // 2. Auto-restart each stalled pipeline
    for (const p of stalled || []) {
      try {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${p.target_function}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ trigger: "watchdog_restart" }),
        });

        const ok = resp.ok;
        result.restarts.push({
          pipeline: p.pipeline_name,
          fn: p.target_function,
          status: resp.status,
          ok,
          minutes_stale: p.minutes_since_success,
          severity: p.severity,
        });

        // Log SLO violation
        await supabase.from("slo_violations").insert({
          pipeline_name: p.pipeline_name,
          violation_type: "staleness_breach",
          expected_value: p.expected_interval_minutes,
          actual_value: p.minutes_since_success,
          severity: p.severity,
          auto_remediated: ok,
          remediation_action: ok ? `restarted ${p.target_function}` : `restart_failed_${resp.status}`,
        });

        // Critical alert if failing repeatedly
        if (p.severity === "critical" || p.consecutive_failures >= 3) {
          await supabase.from("critical_alerts").insert({
            headline: `Pipeline stalled: ${p.pipeline_name} (${Math.round(p.minutes_since_success)}m, ${p.consecutive_failures} fails)`,
            level: "critical",
            event_type: "pipeline_stall",
            meta: {
              pipeline: p.pipeline_name,
              minutes_stale: p.minutes_since_success,
              consecutive_failures: p.consecutive_failures,
              auto_restart_attempted: true,
              auto_restart_ok: ok,
            },
          });
        }
      } catch (e) {
        result.restarts.push({
          pipeline: p.pipeline_name,
          error: (e as Error).message,
        });
      }
    }

    // 3. Run canary probe
    const { data: canary } = await supabase.rpc("run_canary_probe");
    result.canary = canary;

    // 4. Self-heartbeat
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "pipeline-watchdog",
      _success: true,
      _metadata: { stalled: result.stalled_count, restarts: result.restarts.length },
    });

    result.duration_ms = Date.now() - startedAt;
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "pipeline-watchdog",
      _success: false,
      _error: msg,
    });
    console.error("pipeline-watchdog error:", e);
    return new Response(JSON.stringify({ ok: false, error: msg, partial: result }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
