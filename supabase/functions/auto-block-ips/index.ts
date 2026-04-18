import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Run rule-based auto-block evaluator
    const { data: blockResult, error } = await supabase.rpc("evaluate_auto_block");
    if (error) throw error;

    // 2. Compute uptime snapshot
    const { data: uptimeResult } = await supabase.rpc("compute_uptime_snapshot");

    // 3. Auto-create incident if down components detected
    const { data: downComponents } = await supabase
      .from("system_health")
      .select("component, status, error_message")
      .eq("status", "down")
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

    let incidentCreated = false;
    if (downComponents && downComponents.length > 0) {
      const components = [...new Set(downComponents.map((c) => c.component))];
      // Check if open incident exists for these components
      const { data: existing } = await supabase
        .from("status_incidents")
        .select("id")
        .is("resolved_at", null)
        .overlaps("affected_components", components);

      if (!existing || existing.length === 0) {
        await supabase.from("status_incidents").insert({
          title: `Service degradation detected: ${components.join(", ")}`,
          description: `Automated detection: ${downComponents.length} health check failures`,
          status: "investigating",
          impact: components.length > 1 ? "major" : "minor",
          affected_components: components,
          updates: [{
            timestamp: new Date().toISOString(),
            message: "Automated incident opened by health monitoring",
            status: "investigating",
          }],
        });
        incidentCreated = true;
      }
    }

    // 4. Auto-resolve incidents if components recovered
    const { data: openIncidents } = await supabase
      .from("status_incidents")
      .select("*")
      .is("resolved_at", null);

    let autoResolved = 0;
    if (openIncidents) {
      for (const inc of openIncidents) {
        const { data: stillDown } = await supabase
          .from("system_health")
          .select("component")
          .eq("status", "down")
          .in("component", inc.affected_components)
          .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

        if (!stillDown || stillDown.length === 0) {
          await supabase.from("status_incidents")
            .update({
              resolved_at: new Date().toISOString(),
              status: "resolved",
              updates: [...(inc.updates || []), {
                timestamp: new Date().toISOString(),
                message: "Auto-resolved: all affected components healthy",
                status: "resolved",
              }],
            })
            .eq("id", inc.id);
          autoResolved++;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      auto_block: blockResult,
      uptime_snapshot: uptimeResult,
      incident_created: incidentCreated,
      incidents_auto_resolved: autoResolved,
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("auto-block-ips error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
