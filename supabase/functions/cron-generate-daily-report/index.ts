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

    const { data, error } = await supabase.functions.invoke("generate-division-report");
    if (error) throw error;

    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (adminRoles) {
      for (const admin of adminRoles) {
        await supabase.from("notifications").insert({
          type: "report",
          title: "Daily Global Division Report Available",
          message: "Your daily AICIS performance report has been generated",
          division: "system",
          user_id: admin.user_id
        });
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: "cron-generate-daily-report",
      status: "success",
      message: "Daily report generated and admins notified"
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Daily report generation completed",
        data
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("cron-generate-daily-report error:", error);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    await supabase.from("automation_logs").insert({
      job_name: "cron-generate-daily-report",
      status: "failure",
      message: `Error: ${errorMessage}`
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
