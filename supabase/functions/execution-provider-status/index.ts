import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  const ibkrConfigured = Boolean(
    (Deno.env.get("IBKR_WEB_API_BASE_URL") ?? "").trim() &&
    (Deno.env.get("IBKR_WEB_API_BEARER_TOKEN") ?? "").trim() &&
    (Deno.env.get("IBKR_ACCOUNT_ID") ?? "").trim()
  );

  return json({
    ok: true,
    providers: [{
      id: "interactive_brokers",
      name: "Interactive Brokers",
      configured: ibkrConfigured,
      capabilities: {
        market_snapshot: ibkrConfigured,
        order_preview_whatif: ibkrConfigured,
        provider_attested_executable_quote: false,
        order_submission: false,
        money_movement: false,
      },
      configuration_boundary: ibkrConfigured
        ? "server_side_session_configured"
        : "server_side_session_not_configured",
      credential_exposure: "none",
    }],
    global_execution_boundary: {
      approval_token_issuance: false,
      order_submission: false,
      contract_signing: false,
      money_movement: false,
    },
  });
});
