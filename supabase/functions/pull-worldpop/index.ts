import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { startProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-scheduler-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISABLED_REASON = "WorldPop live provider adapter is not configured; synthetic fallback is disabled";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "worldpop",
    endpoint: "pull-worldpop",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
    run_mode: "disabled_pending_real_adapter",
  });

  const error = new Error(DISABLED_REASON);
  await failProviderRun(supabase, run, error);

  await supabase.from("system_logs").insert({
    division: "population",
    action: "worldpop_data_pull",
    result: "blocked",
    log_level: "warning",
    metadata: {
      reason: DISABLED_REASON,
      synthetic_persistence_disabled: true,
      records_written: 0,
    },
  });

  return json({
    ok: false,
    error: DISABLED_REASON,
    records_written: 0,
    synthetic_persistence_disabled: true,
  }, 503);
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
