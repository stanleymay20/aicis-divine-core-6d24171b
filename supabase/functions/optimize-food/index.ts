import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const measuredNumbers = (rows: any[], key: string) => rows
  .map((row) => Number(row?.[key]))
  .filter((value) => Number.isFinite(value));

const average = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { data: foodData, error: fetchError } = await supabaseClient
      .from("food_security")
      .select("*")
      .order("alert_level", { ascending: false });
    if (fetchError) throw fetchError;

    if (!foodData?.length) {
      return new Response(JSON.stringify({
        success: false,
        code: "no_observed_food_data",
        message: "No observed food-security records are available. Optimization is not generated from synthetic data.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const yieldValues = measuredNumbers(foodData, "yield_index");
    const supplyValues = measuredNumbers(foodData, "supply_days");
    const avgYield = average(yieldValues);
    const avgSupplyDays = average(supplyValues);
    const criticalRegions = foodData.filter((row: any) => row.alert_level === "critical" || row.alert_level === "emergency").length;

    const evidence = foodData.slice(0, 100).map((row: any) => ({
      region: row.region,
      crop: row.crop,
      yield_index: row.yield_index,
      alert_level: row.alert_level,
      supply_days: row.supply_days,
      notes: row.notes,
      updated_at: row.updated_at,
    }));

    const ai = await aiChat({
      messages: [
        {
          role: "system",
          content: "You are an AICIS food-security analyst. Use only the supplied observed records. Do not invent harvests, shortages, prices, logistics capacity, government stocks, weather, trade flows, or causal explanations. Treat null values as unmeasured. Recommendations are advisory scenarios, not operational directives. Separate observed risks from assumptions and state uncertainty.",
        },
        {
          role: "user",
          content: `Observed food-security records:\n${JSON.stringify(evidence).slice(0, 15000)}\n\nProvide: (1) evidence-supported shortage risks, (2) cautious resource-allocation options, and (3) longer-term resilience options.`,
        },
      ],
      temperature: 0.1,
      maxTokens: 900,
      timeoutMs: 15000,
    });

    const recommendations = `${ai.content}\n\nEvidence basis: ${foodData.length} food_security rows. Yield measurements present: ${yieldValues.length}; supply-day measurements present: ${supplyValues.length}. Provider: ${ai.provider}; model: ${ai.model}. Advisory analysis only.`;

    await supabaseClient.from("system_logs").insert({
      action: "food_optimization",
      details: `Analysed ${foodData.length} observed food-security records. Critical/emergency: ${criticalRegions}. Measured yield rows: ${yieldValues.length}.`,
      performed_by: user.id,
    });

    return new Response(JSON.stringify({
      success: true,
      metrics: {
        average_yield_index: avgYield === null ? null : Number(avgYield.toFixed(2)),
        critical_regions: criticalRegions,
        average_supply_days: avgSupplyDays === null ? null : Math.round(avgSupplyDays),
        total_monitored: foodData.length,
        measured_yield_rows: yieldValues.length,
        measured_supply_days_rows: supplyValues.length,
      },
      recommendations,
      provider: ai.provider,
      model: ai.model,
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in optimize-food:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
