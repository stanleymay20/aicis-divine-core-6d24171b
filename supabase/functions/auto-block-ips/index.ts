import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface DownComponent {
  component: string;
  status: string;
  error_message: string | null;
}

interface OpenIncident {
  id: string;
  affected_components: unknown;
  updates: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const { data: blockResult, error: blockError } = await supabase.rpc("evaluate_auto_block");
    if (blockError) throw blockError;

    const { data: uptimeResult, error: uptimeError } = await supabase.rpc("compute_uptime_snapshot");
    if (uptimeError) throw uptimeError;

    const { data: downRaw, error: downError } = await supabase
      .from("system_health")
      .select("component, status, error_message")
      .eq("status", "down")
      .gte("checked_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (downError) throw downError;
    const downComponents = (downRaw ?? []) as DownComponent[];

    let incidentCreated = false;
    if (downComponents.length > 0) {
      const components = [...new Set(downComponents.map((item) => item.component).filter(Boolean))];
      const { data: existing, error: existingError } = await supabase
        .from("status_incidents")
        .select("id")
        .is("resolved_at", null)
        .overlaps("affected_components", components);
      if (existingError) throw existingError;

      if ((existing?.length ?? 0) === 0) {
        const { error: incidentError } = await supabase.from("status_incidents").insert({
          title: `Service degradation detected: ${components.join(", ")}`,
          description: `Automated detection: ${downComponents.length} recent health-check failures`,
          status: "investigating",
          impact: components.length > 1 ? "major" : "minor",
          affected_components: components,
          updates: [{
            timestamp: new Date().toISOString(),
            message: "Automated incident opened from observed system_health failures",
            status: "investigating",
          }],
        });
        if (incidentError) throw incidentError;
        incidentCreated = true;
      }
    }

    const { data: incidentsRaw, error: incidentsError } = await supabase
      .from("status_incidents")
      .select("id, affected_components, updates")
      .is("resolved_at", null);
    if (incidentsError) throw incidentsError;
    const openIncidents = (incidentsRaw ?? []) as OpenIncident[];

    let autoResolved = 0;
    for (const incident of openIncidents) {
      const affected = Array.isArray(incident.affected_components)
        ? incident.affected_components.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      if (affected.length === 0) continue;

      const { data: stillDown, error: healthError } = await supabase
        .from("system_health")
        .select("component")
        .eq("status", "down")
        .in("component", affected)
        .gte("checked_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
      if (healthError) throw healthError;

      if ((stillDown?.length ?? 0) === 0) {
        const priorUpdates = Array.isArray(incident.updates) ? incident.updates : [];
        const { error: resolveError } = await supabase.from("status_incidents")
          .update({
            resolved_at: new Date().toISOString(),
            status: "resolved",
            updates: [...priorUpdates, {
              timestamp: new Date().toISOString(),
              message: "Auto-resolved after affected components returned healthy",
              status: "resolved",
            }],
          })
          .eq("id", incident.id);
        if (resolveError) throw resolveError;
        autoResolved += 1;
      }
    }

    return json({
      ok: true,
      auto_block: blockResult,
      uptime_snapshot: uptimeResult,
      incident_created: incidentCreated,
      incidents_auto_resolved: autoResolved,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("auto-block-ips error", message);
    return json({ error: message }, 500);
  }
});
