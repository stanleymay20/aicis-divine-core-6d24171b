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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-crisis-scan",
      status: "running",
      message: "Starting crisis detection scan",
    });

    // v11: Hard 55s client-side abort prevents 1h zombie state if downstream hangs.
    // crisis-scan itself has a 50s deadline, so 55s here is the outer envelope.
    const ctrl = new AbortController();
    const watchdog = setTimeout(() => ctrl.abort("cron-watchdog-55s"), 55_000);
    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/crisis-scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ source: "cron" }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(watchdog);
    }

    if (!response.ok) {
      const errorText = await response.text();
      await supabase.from("automation_logs").insert({
        job_name: "cron-hourly-crisis-scan",
        status: "error",
        message: `HTTP ${response.status}: ${errorText.slice(0, 400)}`,
      });
      return new Response(
        JSON.stringify({ error: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const aiSkipped = data?.ai_skipped ? " (AI credits exhausted)" : "";

    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-crisis-scan",
      status: "success",
      message: `Crisis scan completed: ${data?.events?.length || 0} events${aiSkipped}`,
    });

    return new Response(
      JSON.stringify({ ok: true, result: data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Error in cron-hourly-crisis-scan:", e);

    await supabase.from("automation_logs").insert({
      job_name: "cron-hourly-crisis-scan",
      status: "error",
      message: ((e as Error).message || "Unknown error").slice(0, 500),
    });

    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
