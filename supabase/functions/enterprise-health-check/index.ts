import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type HealthStatus = "healthy" | "degraded" | "down";

interface HealthCheck {
  component: string;
  status: HealthStatus;
  response_time_ms?: number;
  error_message?: string;
  basis: string;
}

async function retryCall<T>(fn: () => Promise<T>, retries = 2, baseMs = 300): Promise<T> {
  let last: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, baseMs * Math.pow(2, attempt)));
      }
    }
  }
  throw last ?? new Error("health_check_failed");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const healthChecks: HealthCheck[] = [];
  const startTime = Date.now();

  try {
    try {
      const dbStart = Date.now();
      await retryCall(async () => {
        const { error } = await supabase.from("organizations").select("id").limit(1);
        if (error) throw error;
      });
      healthChecks.push({
        component: "database",
        status: "healthy",
        response_time_ms: Date.now() - dbStart,
        basis: "Service-role read query completed successfully.",
      });
    } catch (error) {
      healthChecks.push({
        component: "database",
        status: "down",
        error_message: messageOf(error),
        basis: "Service-role read query failed after retry.",
      });
    }

    try {
      const storageStart = Date.now();
      await retryCall(async () => {
        const { error } = await supabase.storage.listBuckets();
        if (error) throw error;
      });
      healthChecks.push({
        component: "storage",
        status: "healthy",
        response_time_ms: Date.now() - storageStart,
        basis: "Storage bucket listing completed successfully.",
      });
    } catch (error) {
      healthChecks.push({
        component: "storage",
        status: "degraded",
        error_message: messageOf(error),
        basis: "Storage bucket listing failed after retry.",
      });
    }

    healthChecks.push({
      component: "edge_runtime",
      status: "healthy",
      response_time_ms: Date.now() - startTime,
      basis: "This health-check function is executing. This does not assert the health of every Edge Function.",
    });

    const healthRows = healthChecks.map((check) => ({
      component: check.component,
      status: check.status,
      response_time_ms: check.response_time_ms ?? null,
      error_message: check.error_message ?? null,
    }));
    const { error: logError } = await supabase.from("system_health").insert(healthRows);
    if (logError) console.warn("Failed to persist health checks:", logError.message);

    const overallStatus: HealthStatus = healthChecks.some((check) => check.status === "down")
      ? "down"
      : healthChecks.some((check) => check.status === "degraded")
      ? "degraded"
      : "healthy";

    return new Response(
      JSON.stringify({
        ok: overallStatus !== "down",
        status: overallStatus,
        checks: healthChecks,
        authenticated_via: auth.via,
        timestamp: new Date().toISOString(),
      }),
      {
        status: overallStatus === "down" ? 503 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Health check error:", error);
    return new Response(JSON.stringify({ error: messageOf(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
