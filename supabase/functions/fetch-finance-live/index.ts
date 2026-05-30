import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const svc = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const run = await startProviderRun(svc, {
    provider_name: "fetch-finance-live",
    endpoint: "fetch-finance-live",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    console.log("Invoking pull-coingecko and pull-alpha-vantage for live finance data...");

    const { data: coingeckoData, error: coingeckoError } = await supabase.functions.invoke('pull-coingecko', { body: {} });
    const { data: alphaVantageData, error: alphaVantageError } = await supabase.functions.invoke('pull-alpha-vantage', { body: {} });

    if (coingeckoError) console.error("CoinGecko error:", coingeckoError);
    if (alphaVantageError) console.error("Alpha Vantage error:", alphaVantageError);

    await supabase.functions.invoke('evaluate-impact');
    await supabase.functions.invoke('learn-policy-weights');

    await finishProviderRun(svc, run, {
      error_count: (coingeckoError ? 1 : 0) + (alphaVantageError ? 1 : 0),
      error_summary: coingeckoError?.message || alphaVantageError?.message || null,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Finance data refreshed successfully from multiple sources",
        data: { coingecko: coingeckoData, alphaVantage: alphaVantageData }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("fetch-finance-live error:", e);
    await failProviderRun(svc, run, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
