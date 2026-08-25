import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const destructiveRetentionEnabled = () =>
  (Deno.env.get("AICIS_RETENTION_DELETION_ENABLED") ?? "").toLowerCase() === "true";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  if (!destructiveRetentionEnabled()) {
    return new Response(JSON.stringify({
      success: false,
      disabled: true,
      reason: "Destructive retention is disabled until archive/parity safeguards are explicitly approved.",
    }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: policies, error: policiesError } = await supabaseClient
      .from("data_retention_policies")
      .select("category,max_days,auto_delete")
      .eq("auto_delete", true);

    if (policiesError) throw policiesError;

    const results: Array<{
      category: string;
      status: "success" | "error";
      cutoff_date?: string;
      error?: string;
    }> = [];

    for (const policy of policies || []) {
      if (!policy.category || !Number.isInteger(policy.max_days) || policy.max_days <= 0) {
        results.push({
          category: policy.category ?? "unknown",
          status: "error",
          error: "Invalid retention policy",
        });
        continue;
      }

      const cutoffDate = new Date();
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - policy.max_days);

      const { error: deleteError } = await supabaseClient
        .from(policy.category)
        .delete()
        .lt("created_at", cutoffDate.toISOString());

      if (deleteError) {
        console.error(`Error purging ${policy.category}:`, deleteError);
        results.push({
          category: policy.category,
          status: "error",
          error: deleteError.message,
        });
      } else {
        results.push({
          category: policy.category,
          status: "success",
          cutoff_date: cutoffDate.toISOString(),
        });
      }
    }

    await supabaseClient.from("system_logs").insert({
      division: "privacy",
      action: "auto_purge_expired_records",
      result: results.some((result) => result.status === "error") ? "partial" : "completed",
      log_level: "info",
      metadata: {
        results,
        destructive_retention_enabled: true,
        executed_via: guard.via,
      }
    });

    return new Response(JSON.stringify({
      success: true,
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in auto-purge-expired-records:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
