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
    const result = await invokeInternalFunction("generate-alerts");
    if (!result.ok) throw new Error(result.error ?? "generate-alerts failed");

    const payload = result.data && typeof result.data === "object"
      ? result.data as Record<string, unknown>
      : {};
    const alertsGenerated = Number(payload.alerts_generated) || 0;

    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-alerts",
      status: "success",
      message: `Generated alerts: ${alertsGenerated}`,
    });

    return new Response(JSON.stringify({ success: true, result: result.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("cron-hourly-alerts error:", message);
    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-alerts",
      status: "error",
      message,
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
