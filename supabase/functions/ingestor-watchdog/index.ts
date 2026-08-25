// Self-healing watchdog for data ingestors.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface Watch {
  name: string;
  log_name: string;
  max_stale_hours: number;
}

interface WatchdogStats {
  healed: string[];
  healthy: string[];
  failed: string[];
}

const WATCHED: Watch[] = [
  { name: "fetch-governance-global", log_name: "fetch-governance-global", max_stale_hours: 8 },
  { name: "pull-entsoe", log_name: "pull-entsoe", max_stale_hours: 12 },
  { name: "fetch-satellite-global", log_name: "fetch-satellite-global", max_stale_hours: 12 },
  { name: "cron-global-intelligence", log_name: "cron-global-intelligence", max_stale_hours: 8 },
  { name: "ingest-resilient-events", log_name: "ingest-resilient-events", max_stale_hours: 2 },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const stats: WatchdogStats = { healed: [], healthy: [], failed: [] };

  for (const watch of WATCHED) {
    try {
      const { data: lastSuccess, error: logError } = await supabase
        .from("automation_logs")
        .select("executed_at")
        .eq("job_name", watch.log_name)
        .eq("status", "success")
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (logError) throw logError;

      const timestamp = lastSuccess?.executed_at ? new Date(lastSuccess.executed_at).getTime() : Number.NaN;
      const ageHours = Number.isFinite(timestamp)
        ? (Date.now() - timestamp) / 3_600_000
        : Number.POSITIVE_INFINITY;

      if (ageHours < watch.max_stale_hours) {
        stats.healthy.push(watch.name);
        continue;
      }

      const invocation = await invokeInternalFunction(
        watch.name,
        { trigger: "watchdog", watchdog: "ingestor-watchdog" },
        45_000,
      );
      if (!invocation.ok) {
        stats.failed.push(`${watch.name}:${invocation.error ?? `HTTP ${invocation.status}`}`);
      } else {
        stats.healed.push(watch.name);
      }
    } catch (error) {
      stats.failed.push(`${watch.name}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const { error: auditError } = await supabase.from("automation_logs").insert({
    job_name: "ingestor-watchdog",
    status: stats.failed.length > 0 ? "partial" : "success",
    message: `Healthy ${stats.healthy.length}, healed ${stats.healed.length}, failed ${stats.failed.length}`,
  });
  if (auditError) console.error("ingestor-watchdog audit log failed", auditError.message);

  return new Response(JSON.stringify({ ok: stats.failed.length === 0, ...stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
