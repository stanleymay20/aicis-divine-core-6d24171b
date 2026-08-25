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
    const { data: nodes, error: nodesError } = await supabaseClient
      .from("accountability_nodes")
      .select("id,joined_at,org_name")
      .eq("verified", true);

    if (nodesError) throw nodesError;

    let activeCount = 0;
    let inactiveCount = 0;

    for (const node of nodes || []) {
      const { data: lastActivity } = await supabaseClient
        .from("node_audit_trail")
        .select("timestamp")
        .eq("node_id", node.id)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastActiveAt = lastActivity?.timestamp || node.joined_at;
      if (!lastActiveAt) {
        inactiveCount += 1;
        await supabaseClient.from("system_logs").insert({
          division: "accountability",
          action: "node_activity_unknown",
          result: "warning",
          log_level: "warn",
          metadata: { node_id: node.id, org_name: node.org_name }
        });
        continue;
      }

      const parsedLastActive = new Date(lastActiveAt).getTime();
      const hoursSinceActive = Number.isFinite(parsedLastActive)
        ? (Date.now() - parsedLastActive) / (1000 * 60 * 60)
        : Number.POSITIVE_INFINITY;

      await supabaseClient
        .from("accountability_nodes")
        .update({ last_active_at: lastActiveAt })
        .eq("id", node.id);

      if (hoursSinceActive > 72) {
        inactiveCount += 1;
        await supabaseClient.from("system_logs").insert({
          division: "accountability",
          action: "node_inactive_warning",
          result: "warning",
          log_level: "warn",
          metadata: {
            node_id: node.id,
            org_name: node.org_name,
            hours_inactive: Number.isFinite(hoursSinceActive) ? Math.round(hoursSinceActive) : null
          }
        });
      } else {
        activeCount += 1;
      }
    }

    const totalNodes = nodes?.length || 0;
    const summary = `Checked ${totalNodes} verified nodes: ${activeCount} active, ${inactiveCount} inactive or unknown`;

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-verify-node-activity",
      status: "success",
      message: summary,
      executed_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({
      success: true,
      total_nodes: totalNodes,
      active_nodes: activeCount,
      inactive_or_unknown_nodes: inactiveCount
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in cron-verify-node-activity:", error);

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-verify-node-activity",
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
