import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const healthCheck = await invokeInternalFunction("enterprise-health-check");
    if (!healthCheck.ok) {
      throw new Error(healthCheck.error ?? "enterprise-health-check failed");
    }

    const cleanupResults = await Promise.all([
      supabase.rpc("cleanup_zombie_jobs"),
      supabase.rpc("cleanup_rate_limits"),
      supabase.rpc("cleanup_expired_exports"),
    ]);
    const cleanupError = cleanupResults.find((result) => result.error)?.error;
    if (cleanupError) throw cleanupError;

    const { data: criticalEvents, error: eventsError } = await supabase
      .from("audit_log")
      .select("id")
      .eq("severity", "critical")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if (eventsError) throw eventsError;

    const criticalCount = criticalEvents?.length ?? 0;
    if (criticalCount > 0) {
      console.warn(`${criticalCount} critical security events observed in the last hour`);
    }

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "cron-enterprise-health",
      _success: true,
      _metadata: { critical_events: criticalCount },
    });

    return new Response(JSON.stringify({
      ok: true,
      timestamp: new Date().toISOString(),
      critical_events: criticalCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("cron-enterprise-health error:", message);
    try {
      await supabase.rpc("register_pipeline_heartbeat", {
        _pipeline_name: "cron-enterprise-health",
        _success: false,
        _error: message,
      });
    } catch {
      // Best-effort heartbeat only.
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
