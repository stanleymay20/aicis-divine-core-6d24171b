/**
 * Pipeline watchdog: detects stalled pipelines, restarts them through the
 * authenticated internal invocation bridge, records SLO violations, and runs
 * the end-to-end canary probe.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface StalledPipeline {
  pipeline_name: string;
  target_function: string;
  minutes_since_success: number;
  expected_interval_minutes: number;
  consecutive_failures: number;
  severity: string;
}

interface RestartResult {
  pipeline: string;
  function_name: string;
  ok: boolean;
  status: number;
  minutes_stale: number;
  severity: string;
  error?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const startedAt = Date.now();
  const restarts: RestartResult[] = [];

  try {
    const { data: stalledRaw, error: stallError } = await supabase.rpc("find_stalled_pipelines");
    if (stallError) throw stallError;
    const stalled = Array.isArray(stalledRaw) ? stalledRaw as StalledPipeline[] : [];

    for (const pipeline of stalled) {
      const target = pipeline.target_function;
      if (!/^[a-z0-9-]+$/.test(target)) {
        restarts.push({
          pipeline: pipeline.pipeline_name,
          function_name: target,
          ok: false,
          status: 400,
          minutes_stale: Number(pipeline.minutes_since_success ?? 0),
          severity: pipeline.severity ?? "unknown",
          error: "invalid_target_function",
        });
        continue;
      }

      const invocation = await invokeInternalFunction(
        target,
        { trigger: "watchdog_restart", pipeline: pipeline.pipeline_name },
        45_000,
      );
      const restart: RestartResult = {
        pipeline: pipeline.pipeline_name,
        function_name: target,
        ok: invocation.ok,
        status: invocation.status,
        minutes_stale: Number(pipeline.minutes_since_success ?? 0),
        severity: pipeline.severity ?? "unknown",
      };
      if (invocation.error) restart.error = invocation.error;
      restarts.push(restart);

      const { error: sloError } = await supabase.from("slo_violations").insert({
        pipeline_name: pipeline.pipeline_name,
        violation_type: "staleness_breach",
        expected_value: Number(pipeline.expected_interval_minutes ?? 0),
        actual_value: Number(pipeline.minutes_since_success ?? 0),
        severity: pipeline.severity,
        auto_remediated: invocation.ok,
        remediation_action: invocation.ok ? `restarted ${target}` : `restart_failed_${invocation.status}`,
      });
      if (sloError) console.error("pipeline-watchdog SLO log failed", sloError.message);

      if (pipeline.severity === "critical" || Number(pipeline.consecutive_failures ?? 0) >= 3) {
        const { error: alertError } = await supabase.from("critical_alerts").insert({
          headline: `Pipeline stalled: ${pipeline.pipeline_name} (${Math.round(Number(pipeline.minutes_since_success ?? 0))}m, ${Number(pipeline.consecutive_failures ?? 0)} fails)`,
          level: "critical",
          event_type: "pipeline_stall",
          meta: {
            pipeline: pipeline.pipeline_name,
            minutes_stale: Number(pipeline.minutes_since_success ?? 0),
            consecutive_failures: Number(pipeline.consecutive_failures ?? 0),
            auto_restart_attempted: true,
            auto_restart_ok: invocation.ok,
            target_function: target,
          },
        });
        if (alertError) console.error("pipeline-watchdog alert failed", alertError.message);
      }
    }

    const { data: canary, error: canaryError } = await supabase.rpc("run_canary_probe");
    if (canaryError) throw canaryError;

    const { error: heartbeatError } = await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "pipeline-watchdog",
      _success: true,
      _metadata: {
        stalled: stalled.length,
        restart_attempts: restarts.length,
        restart_failures: restarts.filter((item) => !item.ok).length,
      },
    });
    if (heartbeatError) console.error("pipeline-watchdog heartbeat failed", heartbeatError.message);

    return json({
      ok: restarts.every((item) => item.ok),
      stalled_count: stalled.length,
      restarts,
      canary,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "pipeline-watchdog",
      _success: false,
      _error: message,
    });
    console.error("pipeline-watchdog error", message);
    return json({ ok: false, error: message, restarts }, 500);
  }
});
