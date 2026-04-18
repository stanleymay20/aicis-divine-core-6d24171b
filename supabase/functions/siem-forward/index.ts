import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, error: 2, critical: 3 };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Pull pending events (cap at 200/run)
    const { data: pending, error: pErr } = await supabase
      .from("siem_forward_queue")
      .select("*")
      .eq("forwarded", false)
      .lt("forward_attempts", 5)
      .order("created_at", { ascending: true })
      .limit(200);

    if (pErr) throw pErr;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, forwarded: 0, message: "no pending events" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get active destinations
    const { data: configs } = await supabase
      .from("siem_forward_config")
      .select("*")
      .eq("enabled", true);

    if (!configs || configs.length === 0) {
      // Mark as forwarded with note (no destination configured)
      await supabase.from("siem_forward_queue")
        .update({ forwarded: true, forwarded_at: new Date().toISOString(), last_error: "no_destination_configured" })
        .in("id", pending.map((e) => e.id));
      return new Response(JSON.stringify({ ok: true, forwarded: 0, drained: pending.length, message: "no destinations" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let totalForwarded = 0;
    const errors: string[] = [];

    for (const event of pending) {
      let allOk = true;
      for (const cfg of configs) {
        const minLevel = SEVERITY_ORDER[cfg.min_severity] ?? 1;
        const evtLevel = SEVERITY_ORDER[event.severity] ?? 0;
        if (evtLevel < minLevel) continue;
        if (cfg.filter_event_types && cfg.filter_event_types.length > 0 &&
            !cfg.filter_event_types.includes(event.event_type)) continue;

        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (cfg.auth_header) headers["Authorization"] = cfg.auth_header;

          const res = await fetch(cfg.endpoint_url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              source: "aicis",
              event_type: event.event_type,
              severity: event.severity,
              timestamp: event.created_at,
              payload: event.payload,
            }),
          });

          if (!res.ok) {
            allOk = false;
            errors.push(`${cfg.destination}:${res.status}`);
          }
        } catch (e) {
          allOk = false;
          errors.push(`${cfg.destination}:${(e as Error).message}`);
        }
      }

      await supabase.from("siem_forward_queue")
        .update({
          forwarded: allOk,
          forwarded_at: allOk ? new Date().toISOString() : null,
          forward_attempts: event.forward_attempts + 1,
          last_error: allOk ? null : errors.slice(-3).join("; "),
        })
        .eq("id", event.id);

      if (allOk) totalForwarded++;
    }

    return new Response(JSON.stringify({
      ok: true,
      forwarded: totalForwarded,
      attempted: pending.length,
      destinations: configs.length,
      errors: errors.slice(0, 5),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("siem-forward error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
