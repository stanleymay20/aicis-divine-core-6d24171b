// Deprecated canonical-event bridge.
// normalized_events is now populated directly by event-grade providers and
// validated ingestion workers. Derived internal surfaces must not be recycled
// into the canonical event store because that duplicates evidence and can turn
// document/signal-level records into apparent real-world events.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "bridge-events-to-normalized";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const { count: canonicalCount, error: countError } = await supabase
      .from("normalized_events")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: "No-op: derived internal event bridging is disabled; event-grade providers write normalized_events directly.",
    });

    return json({
      success: true,
      bridged: 0,
      disabled: true,
      canonical_events_currently_recorded: canonicalCount ?? 0,
      policy: {
        normalized_events: "event-grade observations only",
        global_signals: "not promoted to events by this bridge",
        security_incidents: "not recycled back into normalized_events",
        crisis_events: "not recycled into canonical events without independent event-grade provenance",
      },
      reason: "Prevents duplicate/circular evidence and document-to-event promotion.",
      authenticated_via: auth.via,
    });
  } catch (error) {
    console.error(`[${FN}]`, error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
