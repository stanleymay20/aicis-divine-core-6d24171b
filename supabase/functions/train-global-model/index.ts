import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: vulnerabilities, error: vulnerabilityError } = await supabase
      .from("vulnerability_scores")
      .select("*")
      .gte("computed_at", thirtyDaysAgo);
    if (vulnerabilityError) throw vulnerabilityError;

    const { data: alerts, error: alertError } = await supabase
      .from("critical_alerts")
      .select("*")
      .gte("triggered_at", thirtyDaysAgo);
    if (alertError) throw alertError;

    const sourcePerformance: Record<string, { count: number; avgSeverity: number }> = {};

    alerts?.forEach((alert: any) => {
      const source = String(alert.meta?.source || "unknown").slice(0, 120);
      if (!sourcePerformance[source]) {
        sourcePerformance[source] = { count: 0, avgSeverity: 0 };
      }
      sourcePerformance[source].count++;
      sourcePerformance[source].avgSeverity += Number(alert.severity || 0);
    });

    Object.keys(sourcePerformance).forEach((source) => {
      const perf = sourcePerformance[source];
      perf.avgSeverity = perf.count > 0 ? perf.avgSeverity / perf.count : 0;
    });

    const { error: logError } = await supabase.from("ai_learning_log").insert({
      source_table: "critical_alerts",
      success: true,
      insight: JSON.stringify({
        period: "30_days",
        vulnerabilities_analyzed: vulnerabilities?.length || 0,
        alerts_analyzed: alerts?.length || 0,
        source_performance: sourcePerformance,
        timestamp: new Date().toISOString(),
      }),
    });
    if (logError) throw logError;

    console.log(JSON.stringify({
      level: "info",
      function: "train-global-model",
      message: "Training analysis complete",
      sources: Object.keys(sourcePerformance).length,
      timestamp: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({
      ok: true,
      analyzed: {
        vulnerabilities: vulnerabilities?.length || 0,
        alerts: alerts?.length || 0,
      },
      sourcePerformance,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      function: "train-global-model",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({ ok: false, error: "Model training analysis failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
