import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Market-data truth floor.
 *
 * Historical versions of this function asked an LLM to "generate realistic market
 * data" and inserted hard-coded sample trades as executed transactions. That is
 * forbidden: generated commentary is not market observation and sample orders are
 * not executed trades.
 *
 * This endpoint now fails closed until a real, attributable market-data provider is
 * configured. When a provider is added, observations must retain provider/source,
 * observed_at, symbol/pair, price/volume fields and a provider event/trade id when
 * available. Actual user/exchange executions must be ingested through a separate,
 * authenticated execution connector—not synthesized here.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    // Do not fabricate a provider response. A future implementation must explicitly
    // configure and call a real provider. Keeping this flag explicit makes accidental
    // reintroduction of sample data harder during migration.
    const provider = Deno.env.get("AICIS_MARKET_DATA_PROVIDER")?.trim();
    const endpoint = Deno.env.get("AICIS_MARKET_DATA_ENDPOINT")?.trim();

    if (!provider || !endpoint) {
      await supabaseClient.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "market_data_fetch",
        result: "no_market_provider_configured",
        log_level: "warning",
        metadata: {
          rows_written: 0,
          synthetic_data_allowed: false,
          required_configuration: ["AICIS_MARKET_DATA_PROVIDER", "AICIS_MARKET_DATA_ENDPOINT"],
        },
      });

      return json({
        ok: false,
        code: "no_market_provider_configured",
        message: "No verified market-data provider is configured. AICIS will not generate or persist synthetic prices, volumes, trades, or profits.",
        rows_written: 0,
      }, 503);
    }

    // Provider adapters must be implemented explicitly rather than treating an
    // arbitrary endpoint as trustworthy data. This guards against silently accepting
    // incompatible/unverified payloads merely because environment variables exist.
    await supabaseClient.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "market_data_fetch",
      result: "provider_adapter_required",
      log_level: "warning",
      metadata: { provider, endpoint_configured: true, rows_written: 0 },
    });

    return json({
      ok: false,
      code: "provider_adapter_required",
      message: `Market provider '${provider}' is configured, but its verified adapter has not yet been implemented. No data was written.`,
      rows_written: 0,
    }, 501);
  } catch (error) {
    console.error("Error in fetch-market-data:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
