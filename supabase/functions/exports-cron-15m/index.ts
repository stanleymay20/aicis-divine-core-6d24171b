// Scheduled scanner: enqueues runs for enabled profiles whose frequency has elapsed.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as baseCorsHeaders } from "../_shared/export-schema.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const FREQ_MINUTES: Record<string, number> = {
  "5m": 5,
  "15m": 15,
  hourly: 60,
  "6h": 360,
  daily: 1440,
  weekly: 10080,
};

type ExportProfileRow = {
  id: string;
  frequency: string;
  last_run_at: string | null;
};

declare const EdgeRuntime: {
  waitUntil?: (promise: Promise<unknown>) => void;
} | undefined;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const { data, error: profileError } = await admin
      .from("export_profiles")
      .select("id,frequency,last_run_at")
      .eq("enabled", true)
      .neq("frequency", "manual");
    if (profileError) throw profileError;

    const profiles = (data ?? []) as ExportProfileRow[];
    const now = Date.now();
    let enqueued = 0;

    for (const profile of profiles) {
      const minutes = FREQ_MINUTES[profile.frequency];
      if (!minutes) continue;
      const lastRunAt = profile.last_run_at ? new Date(profile.last_run_at).getTime() : 0;
      if (now - lastRunAt < minutes * 60_000) continue;

      const { data: run, error: runError } = await admin.from("export_runs").insert({
        profile_id: profile.id,
        status: "queued",
        trigger_source: "cron",
        format: "json",
      }).select("id").single();
      if (runError) throw runError;
      if (!run?.id) continue;

      const runnerPromise = invokeInternalFunction("exports-runner", { run_id: run.id }, 55_000)
        .then((result) => {
          if (!result.ok) {
            console.error(`exports-runner failed for ${run.id}: ${result.error ?? result.status}`);
          }
          return result;
        });

      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(runnerPromise);
      } else {
        await runnerPromise;
      }
      enqueued += 1;
    }

    return new Response(JSON.stringify({ ok: true, enqueued }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
