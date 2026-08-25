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
    const { data, error } = await supabaseClient.functions.invoke("sdg-evaluate-progress", {
      body: {}
    });

    if (error) throw error;

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-sdg-progress-update",
      status: "success",
      message: "SDG progress evaluation completed",
      executed_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({
      success: true,
      message: "SDG progress evaluation completed",
      data
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in cron-sdg-progress-update:", error);

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-sdg-progress-update",
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
