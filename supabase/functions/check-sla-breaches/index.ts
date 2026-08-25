import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface SlaDefinition {
  pipeline_name: string;
  max_stale_hours: number;
  max_consecutive_failures: number;
  target_uptime_pct: number;
}

interface PipelineHealth {
  pipeline_name: string;
  last_success_at: string | null;
  consecutive_failures: number | null;
}

interface AutomationLog {
  job_name: string;
  status: string;
  executed_at: string;
}

interface Breach {
  pipeline_name: string;
  breach_type: "staleness" | "consecutive_failures" | "uptime";
  threshold: string | number;
  actual: string | number;
  severity: "critical" | "warning";
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const [slaResult, pipelineResult, logResult] = await Promise.all([
      supabase.from("sla_definitions").select("pipeline_name,max_stale_hours,max_consecutive_failures,target_uptime_pct"),
      supabase.from("pipeline_health").select("pipeline_name,last_success_at,consecutive_failures"),
      supabase.from("automation_logs").select("job_name,status,executed_at")
        .order("executed_at", { ascending: false }).limit(500),
    ]);
    if (slaResult.error) throw slaResult.error;
    if (pipelineResult.error) throw pipelineResult.error;
    if (logResult.error) throw logResult.error;

    const slas = (slaResult.data ?? []) as SlaDefinition[];
    const pipelines = (pipelineResult.data ?? []) as PipelineHealth[];
    const recentLogs = (logResult.data ?? []) as AutomationLog[];
    if (slas.length === 0) return json({ breaches: [], checked: 0, recovered: 0 });

    const now = Date.now();
    const breaches: Breach[] = [];

    for (const sla of slas) {
      const pipeline = pipelines.find((item) => item.pipeline_name === sla.pipeline_name);
      const pipelineLogs = recentLogs.filter((item) => item.job_name === sla.pipeline_name);
      const maxStaleHours = Number(sla.max_stale_hours);
      const maxFailures = Number(sla.max_consecutive_failures);
      const targetUptime = Number(sla.target_uptime_pct);

      const lastSuccessMs = pipeline?.last_success_at ? new Date(pipeline.last_success_at).getTime() : Number.NaN;
      const staleHours = Number.isFinite(lastSuccessMs)
        ? (now - lastSuccessMs) / 3_600_000
        : Number.POSITIVE_INFINITY;
      if (staleHours > maxStaleHours) {
        breaches.push({
          pipeline_name: sla.pipeline_name,
          breach_type: "staleness",
          threshold: `${maxStaleHours}h`,
          actual: Number.isFinite(staleHours) ? `${Math.round(staleHours)}h` : "no successful run recorded",
          severity: !Number.isFinite(staleHours) || staleHours > maxStaleHours * 2 ? "critical" : "warning",
        });
      }

      const failureCount = Number(pipeline?.consecutive_failures ?? 0);
      if (failureCount >= maxFailures) {
        breaches.push({
          pipeline_name: sla.pipeline_name,
          breach_type: "consecutive_failures",
          threshold: maxFailures,
          actual: failureCount,
          severity: "critical",
        });
      }

      const relevant = pipelineLogs.slice(0, 20);
      if (relevant.length >= 5) {
        const successes = relevant.filter((item) => item.status === "success").length;
        const uptime = (successes / relevant.length) * 100;
        if (uptime < targetUptime) {
          breaches.push({
            pipeline_name: sla.pipeline_name,
            breach_type: "uptime",
            threshold: `${targetUptime}%`,
            actual: `${Math.round(uptime)}%`,
            severity: uptime < targetUptime - 5 ? "critical" : "warning",
          });
        }
      }
    }

    const cooldownCutoff = new Date(Date.now() - 6 * 3_600_000).toISOString();
    for (const breach of breaches.filter((item) => item.severity === "critical")) {
      const { data: existing, error: existingError } = await supabase
        .from("critical_alerts")
        .select("id")
        .eq("event_type", "sla_breach")
        .gte("triggered_at", cooldownCutoff)
        .contains("meta", { pipeline_name: breach.pipeline_name, breach_type: breach.breach_type })
        .limit(1);
      if (existingError) throw existingError;

      if ((existing?.length ?? 0) === 0) {
        const { error: alertError } = await supabase.from("critical_alerts").insert({
          headline: `SLA breach: ${breach.pipeline_name} — ${breach.breach_type} (${breach.actual} vs ${breach.threshold})`,
          level: "critical",
          severity: 7,
          event_type: "sla_breach",
          meta: breach,
        });
        if (alertError) throw alertError;
      }
    }

    const recoveredPipelines = slas
      .map((sla) => sla.pipeline_name)
      .filter((name) => !breaches.some((breach) => breach.pipeline_name === name));
    for (const name of recoveredPipelines) {
      const { error: resolveError } = await supabase
        .from("critical_alerts")
        .update({ acknowledged: true, ack_by: "system-auto-resolved" })
        .eq("event_type", "sla_breach")
        .eq("acknowledged", false)
        .contains("meta", { pipeline_name: name });
      if (resolveError) throw resolveError;
    }

    return json({
      breaches,
      checked: slas.length,
      recovered: recoveredPipelines.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
