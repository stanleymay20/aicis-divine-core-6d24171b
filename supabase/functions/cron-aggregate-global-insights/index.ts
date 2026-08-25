import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    console.log("Starting daily global insights aggregation...");

    const { data: insightsData, error: insightsError } = await supabase.functions.invoke("aggregate-global-insights");
    if (insightsError) throw insightsError;

    const { data: anomaliesData, error: anomaliesError } = await supabase.functions.invoke("detect-global-anomalies");
    if (anomaliesError) throw anomaliesError;

    await supabase.from("automation_logs").insert({
      job_name: "cron-aggregate-global-insights",
      status: "success",
      message: "Global insights aggregated and anomalies detected"
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Daily global insights aggregation completed",
        insights: insightsData,
        anomalies: anomaliesData
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("cron-aggregate-global-insights error:", error);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    await supabase.from("automation_logs").insert({
      job_name: "cron-aggregate-global-insights",
      status: "failure",
      message: `Error: ${errorMessage}`
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
