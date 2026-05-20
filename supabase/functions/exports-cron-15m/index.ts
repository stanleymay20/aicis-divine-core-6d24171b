// Scheduled scanner: enqueues runs for enabled profiles whose frequency has elapsed.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/export-schema.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const FREQ_MINUTES: Record<string, number> = {
  "5m": 5, "15m": 15, "hourly": 60, "6h": 360, "daily": 1440, "weekly": 10080,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { data: profiles } = await admin.from("export_profiles")
      .select("id, frequency, last_run_at")
      .eq("enabled", true)
      .neq("frequency", "manual");
    const now = Date.now();
    let enqueued = 0;
    for (const p of profiles ?? []) {
      const minutes = FREQ_MINUTES[p.frequency];
      if (!minutes) continue;
      const last = p.last_run_at ? new Date(p.last_run_at).getTime() : 0;
      if (now - last < minutes * 60_000) continue;
      const { data: run } = await admin.from("export_runs").insert({
        profile_id: p.id, status: "queued", trigger_source: "cron", format: "json",
      }).select().single();
      if (run) {
        admin.functions.invoke("exports-runner", { body: { run_id: run.id } }).catch(() => {});
        enqueued++;
      }
    }
    return new Response(JSON.stringify({ ok: true, enqueued }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
