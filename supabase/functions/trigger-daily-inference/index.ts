import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const domains = ["economy", "health", "security", "energy", "food", "governance", "education"];
    const results: Array<{ domain: string; ok: boolean; recommendations?: number; error?: string }> = [];

    for (const domain of domains) {
      try {
        const { data, error } = await supabase.functions.invoke("decision-infer", {
          body: { domain, auto_capture: true },
        });

        if (error) {
          results.push({ domain, ok: false, error: error.message });
        } else {
          results.push({ domain, ok: true, recommendations: data?.recommendations?.length || 0 });
        }
      } catch (e) {
        results.push({ domain, ok: false, error: (e as Error).message });
      }
    }

    const totalRecs = results.filter(r => r.ok).reduce((sum, r) => sum + (r.recommendations || 0), 0);
    const failedDomains = results.filter(r => !r.ok).length;

    // Log to system_logs
    await supabase.from("system_logs").insert({
      action: "daily_inference_trigger",
      result: JSON.stringify({ total_recommendations: totalRecs, failed_domains: failedDomains, results }),
      log_level: failedDomains > 0 ? "warning" : "info",
      division: "decision-engine",
    });

    // Write to audit_log
    await supabase.from("audit_log").insert({
      action: "daily_inference_trigger",
      resource_type: "decision-engine",
      severity: "info",
      metadata: { total_recommendations: totalRecs, failed_domains: failedDomains, domains_run: domains.length },
    });

    // Upsert daily_system_health
    const today = new Date().toISOString().split("T")[0];
    const { count: inferenceCount } = await supabase
      .from("decision_inference_audit").select("id", { count: "exact", head: true })
      .gte("created_at", today);
    const { count: capturedCount } = await supabase
      .from("decision_outcome_log").select("id", { count: "exact", head: true })
      .gte("created_at", today);
    const { count: execCount } = await supabase
      .from("decision_outcome_log").select("id", { count: "exact", head: true })
      .gte("execution_started_at", today);
    const { count: outcomeCount } = await supabase
      .from("decision_outcome_log").select("id", { count: "exact", head: true })
      .gte("outcome_timestamp", today);
    const { count: measuredCount } = await supabase
      .from("decision_outcome_log").select("id", { count: "exact", head: true })
      .eq("evidence_type", "measured").gte("outcome_timestamp", today);

    await supabase.from("daily_system_health").upsert({
      health_date: today,
      inferences_generated: inferenceCount ?? 0,
      decisions_captured: capturedCount ?? 0,
      executions_started: execCount ?? 0,
      outcomes_recorded: outcomeCount ?? 0,
      measured_outcomes: measuredCount ?? 0,
    }, { onConflict: "health_date" });

    // Write usage to billing queue
    await supabase.from("billing_usage_queue").insert({
      metric_key: "decisions_created",
      quantity: totalRecs,
    });

    return new Response(JSON.stringify({
      ok: true,
      total_recommendations: totalRecs,
      failed_domains: failedDomains,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Daily inference error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
