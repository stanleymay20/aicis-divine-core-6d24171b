import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-partner-sync",
      status: "running",
      message: "Starting partner sync job",
    });

    const { data, error } = await supabase.functions.invoke("gov-sync-partners", {
      body: {},
    });

    if (error) throw error;

    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-partner-sync",
      status: "success",
      message: `Partners synced: ${JSON.stringify(data)}`,
    });

    return new Response(
      JSON.stringify({ ok: true, data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in cron-6h-partner-sync:", error);

    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-partner-sync",
      status: "error",
      message: errorMessage,
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
