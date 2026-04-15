import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Mark overdue: not_started items past their SLA
    const { data: overdue, error: overdueErr } = await sb.rpc("raw_sql_readonly" as any);
    // Use direct query approach instead
    const { data: notStarted } = await sb
      .from("decision_outcome_log")
      .select("id, created_at, review_sla_hours, execution_status")
      .eq("execution_status", "not_started");

    let escalated = 0;
    let autoStarted = 0;
    const now = Date.now();

    for (const item of notStarted || []) {
      const slaHours = item.review_sla_hours || 24;
      const createdMs = new Date(item.created_at).getTime();
      const elapsedHours = (now - createdMs) / 3_600_000;

      if (elapsedHours > slaHours) {
        // Mark as overdue
        await sb.from("decision_outcome_log")
          .update({ execution_status: "overdue" })
          .eq("id", item.id);
        escalated++;
      }
    }

    // 2. Auto-start high-severity decisions that have been not_started for >2h
    const { data: highSev } = await sb
      .from("decision_outcome_log")
      .select("id, decision_id, created_at, signal_confidence")
      .eq("execution_status", "not_started")
      .gte("signal_confidence", 0.7)
      .order("created_at", { ascending: true })
      .limit(10);

    for (const item of highSev || []) {
      const elapsedHours = (now - new Date(item.created_at).getTime()) / 3_600_000;
      if (elapsedHours > 2) {
        await sb.from("decision_outcome_log")
          .update({
            execution_status: "in_progress",
            action_taken: true,
            action_taken_at: new Date().toISOString(),
            execution_started_at: new Date().toISOString(),
            action_type: "auto_escalated",
          })
          .eq("id", item.id);
        autoStarted++;
      }
    }

    // 3. Generate critical alerts for severely overdue items (>48h)
    const { data: severelyOverdue } = await sb
      .from("decision_outcome_log")
      .select("id, signal_title, domain, created_at")
      .eq("execution_status", "overdue");

    let alertsCreated = 0;
    for (const item of severelyOverdue || []) {
      const elapsedHours = (now - new Date(item.created_at).getTime()) / 3_600_000;
      if (elapsedHours > 48) {
        // Check if alert already exists
        const { count } = await sb
          .from("critical_alerts")
          .select("id", { count: "exact", head: true })
          .eq("incident_id", item.id)
          .eq("event_type", "execution_breach");

        if ((count || 0) === 0) {
          await sb.from("critical_alerts").insert({
            headline: `EXECUTION BREACH: "${item.signal_title}" overdue by ${Math.round(elapsedHours)}h`,
            level: "critical",
            event_type: "execution_breach",
            severity: 9,
            incident_id: null,
            meta: { outcome_id: item.id, domain: item.domain, overdue_hours: Math.round(elapsedHours) },
          });
          alertsCreated++;
        }
      }
    }

    // Log run
    await sb.from("automation_logs").insert({
      job_name: "auto-escalate-decisions",
      status: "success",
      message: `Escalated ${escalated} to overdue, auto-started ${autoStarted} high-severity, created ${alertsCreated} breach alerts`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        escalated_to_overdue: escalated,
        auto_started: autoStarted,
        breach_alerts_created: alertsCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("auto-escalate-decisions error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
