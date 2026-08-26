import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * fed-fanout-down: Push global learnings (L4) back down to local nodes (L0-L3).
 * Reads recent global division weight changes + regional insights, broadcasts
 * a digest to every verified accountability node via the notifications table.
 */
serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    // 1. Pull recent global weight updates
    const { data: weights } = await supabase
      .from("division_learning_weights")
      .select("division, weight, updated_at")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false });

    // 2. Pull recent regional insights
    const { data: regional } = await supabase
      .from("regional_insights")
      .select("region_name, domain, metric_value, trend")
      .gte("computed_at", since)
      .order("computed_at", { ascending: false })
      .limit(50);

    const payload = {
      generated_at: new Date().toISOString(),
      window_hours: 6,
      global_weight_updates: weights ?? [],
      regional_insights: regional ?? [],
      summary: {
        weight_changes: weights?.length ?? 0,
        regional_signals: regional?.length ?? 0,
      },
    };

    // 3. Insert broadcast record
    const { data: broadcast, error: bErr } = await supabase
      .from("federation_learning_broadcasts")
      .insert({
        broadcast_type: "global_prior_update",
        source_tier: "L4",
        target_tiers: ["L0", "L1", "L2", "L3"],
        payload,
      })
      .select()
      .single();

    if (bErr) throw bErr;

    // 4. Get verified accountability nodes
    const { data: nodes } = await supabase
      .from("accountability_nodes")
      .select("id, org_name, contact_email")
      .eq("verified", true);

    let deliveredCount = 0;

    // 5. Insert a notification per node
    if (nodes && nodes.length > 0) {
      const notifications = nodes.map((n) => ({
        title: "Global Intelligence Update",
        message: `${payload.summary.weight_changes} weight updates and ${payload.summary.regional_signals} regional signals available from the global federation.`,
        notification_type: "federation_broadcast",
        severity: "info",
        metadata: {
          broadcast_id: broadcast.id,
          node_id: n.id,
          org_name: n.org_name,
        },
      }));

      const { error: nErr } = await supabase.from("notifications").insert(notifications);
      if (!nErr) deliveredCount = nodes.length;
    }

    // 6. Update broadcast with delivered count
    await supabase
      .from("federation_learning_broadcasts")
      .update({ delivered_count: deliveredCount })
      .eq("id", broadcast.id);

    await supabase.from("system_logs").insert({
      action: "fed_fanout_down",
      result: `Broadcast to ${deliveredCount} nodes`,
      log_level: "info",
      division: "system",
      metadata: { broadcast_id: broadcast.id, delivered: deliveredCount },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        broadcast_id: broadcast.id,
        delivered: deliveredCount,
        summary: payload.summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("fed-fanout-down error:", error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
