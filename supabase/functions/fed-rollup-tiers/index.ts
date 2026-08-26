import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * fed-rollup-tiers: aggregate L0 community_metrics → L1 urban_metrics
 * and L2 country_performance_snapshots → L3 regional_insights.
 */
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
    const { data: l1Result, error: l1Err } = await supabase.rpc("rollup_community_to_urban");
    const { data: l3Result, error: l3Err } = await supabase.rpc("rollup_country_to_regional");

    const l1Count = l1Err ? 0 : (l1Result as number) ?? 0;
    const l3Count = l3Err ? 0 : (l3Result as number) ?? 0;

    await supabase.from("system_logs").insert({
      action: "fed_rollup_tiers",
      result: `L0→L1: ${l1Count} urban rows, L2→L3: ${l3Count} regional rows`,
      log_level: l1Err || l3Err ? "warn" : "info",
      division: "system",
      metadata: {
        l1_inserted: l1Count,
        l3_inserted: l3Count,
        l1_error: l1Err?.message,
        l3_error: l3Err?.message,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        l1_urban_inserted: l1Count,
        l3_regional_inserted: l3Count,
        errors: { l1: l1Err?.message ?? null, l3: l3Err?.message ?? null },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("fed-rollup-tiers error:", error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
