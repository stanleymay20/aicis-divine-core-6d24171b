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

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Starting usage aggregation...");

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const periodStart = yesterday.toISOString();
    const periodEnd = new Date(yesterday);
    periodEnd.setHours(23, 59, 59, 999);
    const periodEndStr = periodEnd.toISOString();

    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from("organizations")
      .select("id, name");

    if (orgsError) throw orgsError;

    let organizationsWithUsage = 0;
    let usageRowsCreated = 0;
    let queueRowsProcessed = 0;

    for (const org of orgs ?? []) {
      const { data: queueRecords, error: queueError } = await supabaseAdmin
        .from("billing_usage_queue")
        .select("id,metric_key,quantity")
        .eq("org_id", org.id)
        .gte("recorded_at", periodStart)
        .lte("recorded_at", periodEndStr)
        .eq("processed", false);

      if (queueError) throw queueError;
      if (!queueRecords || queueRecords.length === 0) continue;

      organizationsWithUsage += 1;
      const metrics: Record<string, number> = {};
      for (const record of queueRecords) {
        const quantity = Number(record.quantity);
        if (!record.metric_key || !Number.isFinite(quantity)) continue;
        metrics[record.metric_key] = (metrics[record.metric_key] ?? 0) + quantity;
      }

      for (const [metricKey, quantity] of Object.entries(metrics)) {
        const { error: usageError } = await supabaseAdmin.from("usage_records").insert({
          org_id: org.id,
          metric_key: metricKey,
          quantity,
          period_start: periodStart,
          period_end: periodEndStr,
          billed: false,
        });
        if (usageError) throw usageError;
        usageRowsCreated += 1;
      }

      const queueIds = queueRecords.map((record) => record.id);
      const { error: processedError } = await supabaseAdmin
        .from("billing_usage_queue")
        .update({ processed: true })
        .in("id", queueIds);
      if (processedError) throw processedError;
      queueRowsProcessed += queueIds.length;
    }

    const period = yesterday.toISOString().split("T")[0];

    await supabaseAdmin.from("system_logs").insert({
      division: "system",
      action: "aggregate_usage",
      log_level: "info",
      result: "Usage aggregated successfully",
      metadata: {
        period,
        organizations_scanned: orgs?.length ?? 0,
        organizations_with_usage: organizationsWithUsage,
        usage_rows_created: usageRowsCreated,
        queue_rows_processed: queueRowsProcessed,
        revenue_metrics_written: false,
        revenue_reason: "Revenue must be derived from authoritative billing events/invoices, not tier labels",
        executed_via: guard.via,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        period,
        organizations_scanned: orgs?.length ?? 0,
        organizations_with_usage: organizationsWithUsage,
        usage_rows_created: usageRowsCreated,
        queue_rows_processed: queueRowsProcessed,
        revenue_metrics_written: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in aggregate-usage:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
