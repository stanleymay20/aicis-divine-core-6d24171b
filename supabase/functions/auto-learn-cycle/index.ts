import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    console.log("Starting auto-learn cycle...");

    // Step 1: Evaluate impact
    const { data: evalData, error: evalError } = await supabase.functions.invoke("evaluate-impact", {
      body: {}
    });

    if (evalError) throw new Error(`Evaluate impact failed: ${evalError.message}`);
    console.log("Impact evaluation complete:", evalData);

    // Step 2: Learn policy weights
    const { data: learnData, error: learnError } = await supabase.functions.invoke("learn-policy-weights", {
      body: {}
    });

    if (learnError) throw new Error(`Learn weights failed: ${learnError.message}`);
    console.log("Weight learning complete:", learnData);

    await supabase.from("system_logs").insert({
      action: "auto_learn_cycle",
      result: `Cycle complete: ${evalData?.divisions || 0} impacts, ${learnData?.updated || 0} weights updated`,
      log_level: "info",
      division: "system"
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        evaluation: evalData,
        learning: learnData
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error in auto-learn cycle:", error);
    
    await supabase.from("system_logs").insert({
      action: "auto_learn_cycle",
      result: `Error: ${errorMessage}`,
      log_level: "error",
      division: "system"
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
