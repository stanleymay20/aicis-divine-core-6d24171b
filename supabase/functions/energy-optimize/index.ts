import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { data: energyData, error: gridError } = await supabaseClient
      .from("energy_grid")
      .select("region, grid_load, capacity, stability_index, renewable_percentage, outage_risk, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (gridError) throw new Error(`energy_grid read failed: ${gridError.message}`);
    if (!energyData?.length) {
      return new Response(JSON.stringify({
        ok: false,
        code: "no_observed_grid_data",
        message: "No observed energy grid measurements are available. Optimization is not produced from synthetic data.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ai = await aiChat({
      messages: [
        {
          role: "system",
          content: "You are an AICIS energy grid analyst. Analyse ONLY the supplied observed measurements. Treat null fields as unmeasured. Do not invent demand, generation, outage, reserve-margin, pricing or infrastructure facts. Recommendations are advisory and must state uncertainty and the evidence limitation.",
        },
        {
          role: "user",
          content: `Observed energy grid measurements:\n${JSON.stringify(energyData).slice(0, 14000)}\n\nAnalyse load, stability and renewable integration and provide evidence-grounded optimization options.`,
        },
      ],
      temperature: 0.1,
      maxTokens: 800,
      timeoutMs: 15000,
    });

    const optimization = `${ai.content}\n\nEvidence basis: ${energyData.length} observed energy_grid rows. Provider: ${ai.provider}; model: ${ai.model}. Advisory analysis only.`;

    await supabaseClient.from("system_logs").insert({
      user_id: user.id,
      division: "energy",
      action: "energy_optimization",
      result: "completed",
      log_level: "success",
      metadata: { optimization, regions: energyData.length, source: "observed_energy_grid", provider: ai.provider, model: ai.model },
    });

    return new Response(JSON.stringify({ optimization, energyData, evidence_rows: energyData.length, provider: ai.provider, model: ai.model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in energy-optimize:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
