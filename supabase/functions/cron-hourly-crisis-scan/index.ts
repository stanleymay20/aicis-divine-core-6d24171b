import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type CrisisScanResult = {
  events?: unknown[];
  ai_skipped?: boolean;
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
    const invocation = await invokeInternalFunction<CrisisScanResult>(
      "crisis-scan",
      { source: "cron" },
      55_000,
    );

    if (!invocation.ok) {
      const message = invocation.error ?? `HTTP ${invocation.status}`;
      await supabase.from("automation_logs").insert({
        job_name: "cron-hourly-crisis-scan",
        status: "error",
        message: message.slice(0, 400),
      });
      return new Response(
        JSON.stringify({ error: message }),
        { status: invocation.status >= 400 ? invocation.status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = invocation.data;
    const aiSkipped = data?.ai_skipped ? " (AI enrichment skipped)" : "";

    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-crisis-scan",
      status: "success",
      message: `Crisis scan completed: ${data?.events?.length || 0} events${aiSkipped}`,
    });

    return new Response(
      JSON.stringify({ ok: true, result: data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in cron-hourly-crisis-scan:", error);

    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-crisis-scan",
      status: "error",
      message: errorMessage.slice(0, 500),
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
