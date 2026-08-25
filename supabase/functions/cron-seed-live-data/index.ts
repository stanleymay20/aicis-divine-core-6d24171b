import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { invokeInternalFunction } from "../_shared/internal-invoke.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    await supabase.from("automation_logs").insert({
      job_name: "cron-seed-live-data",
      status: "running",
      message: "Starting live data population cron",
    });

    const result = await invokeInternalFunction<{ results?: unknown }>("seed-live-data");
    if (!result.ok) throw new Error(result.error ?? "seed-live-data invocation failed");

    await supabase.from("automation_logs").insert({
      job_name: "cron-seed-live-data",
      status: "success",
      message: `Live data cron completed: ${JSON.stringify(result.data?.results ?? {})}`.slice(0, 1000),
    });

    return json({ ok: true, result: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in cron-seed-live-data:", message);

    await supabase.from("automation_logs").insert({
      job_name: "cron-seed-live-data",
      status: "error",
      message: message.slice(0, 500),
    });

    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
