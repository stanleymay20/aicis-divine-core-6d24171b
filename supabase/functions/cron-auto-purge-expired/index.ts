import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type PurgeResult = {
  success?: boolean;
  disabled?: boolean;
  reason?: string;
  results?: unknown[];
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
    const invocation = await invokeInternalFunction<PurgeResult>("auto-purge-expired-records", {});

    if (!invocation.ok) {
      const disabled = invocation.status === 409 && invocation.data?.disabled === true;
      await supabaseClient.from("automation_logs").insert({
        job_name: "cron-auto-purge-expired",
        status: disabled ? "disabled" : "error",
        message: disabled
          ? invocation.data?.reason ?? "Destructive retention is disabled"
          : invocation.error ?? "Retention worker failed",
        executed_at: new Date().toISOString()
      });

      return new Response(JSON.stringify({
        success: false,
        disabled,
        reason: invocation.data?.reason ?? invocation.error,
      }), {
        status: invocation.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const processed = invocation.data?.results?.length ?? 0;
    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-auto-purge-expired",
      status: "success",
      message: `Purged expired records: ${processed} categories processed`,
      executed_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({
      success: true,
      message: "Auto-purge completed",
      data: invocation.data,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in cron-auto-purge-expired:", error);

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-auto-purge-expired",
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
