import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("Running daily bias scan...");

    const { data, error } = await supabaseClient.functions.invoke("analyze-bias-trend", {
      body: {}
    });

    if (error) throw error;

    const avgBias = Number(data?.trends?.overall?.avg_bias ?? 0);
    const highBiasCount = Number(data?.trends?.overall?.high_bias_count ?? 0);

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-daily-bias-scan",
      status: "success",
      message: `Bias scan complete. Avg bias: ${avgBias.toFixed(2)}%, High bias events: ${highBiasCount}`,
      executed_at: new Date().toISOString()
    });

    if (highBiasCount > 0) {
      const { data: admins } = await supabaseClient
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      if (admins) {
        for (const admin of admins) {
          await supabaseClient.from("notifications").insert({
            user_id: admin.user_id,
            type: "warning",
            title: "High Bias Detected",
            message: `${highBiasCount} AI decisions flagged for high bias. Average bias: ${avgBias.toFixed(2)}%`,
            division: "ethics",
            link: "/ethics"
          });
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Bias scan completed",
      data
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in cron-daily-bias-scan:", error);

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-daily-bias-scan",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
      executed_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
