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

    const [{ data: trades, error: tradeError }, { data: energyData, error: energyError }] = await Promise.all([
      supabaseClient.from("trades").select("id,exchange,pair,side,amount,price,profit,status,executed_at,created_at").order("created_at", { ascending: false }).limit(100),
      supabaseClient.from("energy_grid").select("region,grid_load,capacity,stability_index,renewable_percentage,outage_risk,updated_at").order("updated_at", { ascending: false }).limit(10),
    ]);
    if (tradeError) throw tradeError;
    if (energyError) throw energyError;

    const executedTrades = (trades || []).filter((trade: any) => trade.status === "executed" || trade.executed_at);
    const profitValues = executedTrades
      .map((trade: any) => Number(trade.profit))
      .filter((value: number) => Number.isFinite(value));
    const realizedTradeProfit = profitValues.reduce((sum: number, value: number) => sum + value, 0);

    const chronological = executedTrades
      .filter((t: any) => Number.isFinite(Number(t.profit)))
      .sort((a: any, b: any) => new Date(a.executed_at || a.created_at).getTime() - new Date(b.executed_at || b.created_at).getTime());
    let observedProfitChangePct: number | null = null;
    if (chronological.length >= 4) {
      const split = Math.floor(chronological.length / 2);
      const older = chronological.slice(0, split).reduce((s: number, t: any) => s + Number(t.profit), 0);
      const newer = chronological.slice(split).reduce((s: number, t: any) => s + Number(t.profit), 0);
      if (older !== 0) observedProfitChangePct = ((newer - older) / Math.abs(older)) * 100;
    }

    const metrics = {
      realized_trading_profit_usd: Number(realizedTradeProfit.toFixed(2)),
      executed_trade_count: executedTrades.length,
      trades_with_measured_profit: profitValues.length,
      observed_profit_change_pct: observedProfitChangePct === null ? null : Number(observedProfitChangePct.toFixed(2)),
      energy_savings_usd: null,
      energy_savings_status: "unmeasured",
      energy_observation_rows: energyData?.length || 0,
    };

    const ai = await aiChat({
      messages: [
        {
          role: "system",
          content: "You are an AICIS financial evidence analyst. Use only the supplied trade records and energy observations. Do not invent revenue, savings, growth, prices, forecasts, or causal claims. Energy-grid measurements do not by themselves prove monetary savings. Distinguish observed profit from unmeasured revenue or savings. Keep the executive summary concise and state data limitations.",
        },
        {
          role: "user",
          content: `Deterministic observed metrics:\n${JSON.stringify(metrics)}\n\nExecuted trade evidence:\n${JSON.stringify(executedTrades.slice(0, 50)).slice(0, 12000)}\n\nEnergy observations (not monetized savings):\n${JSON.stringify(energyData || []).slice(0, 5000)}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 700,
      timeoutMs: 15000,
    });

    const analysis = `${ai.content}\n\nEvidence basis: ${executedTrades.length} executed trades and ${energyData?.length || 0} energy-grid observations. No synthetic revenue_streams rows were created. Provider: ${ai.provider}; model: ${ai.model}.`;

    // Deliberately do NOT insert cumulative analysis totals into revenue_streams.
    // revenue_streams must contain independently observed/attributable revenue events,
    // otherwise repeated analyses would double-count the same underlying trades.
    await supabaseClient.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "revenue_analysis",
      result: "success",
      log_level: "info",
      metadata: { ...metrics, provider: ai.provider, model: ai.model, synthetic_revenue_writes: false },
    });

    return new Response(JSON.stringify({ analysis, metrics, provider: ai.provider, model: ai.model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-revenue:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
