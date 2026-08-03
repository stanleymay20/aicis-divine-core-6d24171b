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
    console.log("Running federation export cron...");

    // No 'running' start row: the zombie-job cleaner flips unclosed rows to
    // 'timeout' even on successful runs. Terminal status is logged below.

    // Step 1: Make bundle
    const makeResult = await supabase.functions.invoke("fed-make-bundle");
    
    if (makeResult.error) {
      throw new Error(`Make bundle failed: ${makeResult.error.message}`);
    }

    // Step 2: Send bundles
    const sendResult = await supabase.functions.invoke("fed-send-bundles");
    
    if (sendResult.error) {
      throw new Error(`Send bundles failed: ${sendResult.error.message}`);
    }

    const summary = `Exported bundle, sent to peers. ${sendResult.data?.sent || 0} successful, ${sendResult.data?.errors || 0} failed`;

    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-federation-export",
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
    console.error("Error in federation export cron:", error);

    await supabase.from("automation_logs").insert({
      job_name: "cron-6h-federation-export",
      status: "error",
      message: errorMessage
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
