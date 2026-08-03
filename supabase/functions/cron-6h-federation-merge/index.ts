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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("Running federation merge cron...");

    // No 'running' start row: the zombie-job cleaner flips unclosed rows to
    // 'timeout' even on successful runs. Terminal status is logged below.

    // Merge global prior
    const mergeResult = await supabase.functions.invoke("fed-merge-global-prior");
    
    if (mergeResult.error) {
      throw new Error(`Merge failed: ${mergeResult.error.message}`);
    }

    const summary = `Merged global prior. ${mergeResult.data?.updated || 0} weights updated`;

    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-federation-merge",
      status: "success",
      message: summary
    });

    console.log(summary);

    return new Response(
      JSON.stringify({ ok: true, message: summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error in federation merge cron:", error);

    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-federation-merge",
      status: "error",
      message: errorMessage
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
