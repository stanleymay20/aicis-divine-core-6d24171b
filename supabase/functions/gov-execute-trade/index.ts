import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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

/**
 * Legacy governance execution quarantine.
 *
 * Historical versions of this endpoint deducted SC wallet balances and marked
 * governance trades executed. It is intentionally disabled so it cannot serve as
 * a parallel execution path beside the auditable AICIS preview/approval architecture.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  return json({
    ok: false,
    code: "legacy_governance_execution_disabled",
    message: "Legacy governance trade execution is disabled. No wallet, ledger, trade, broker, contract, or payment action was performed.",
    replacement: "preview-execution",
    execution_boundary: {
      wallet_debited: false,
      ledger_written: false,
      trade_executed: false,
      order_submitted: false,
      money_moved: false,
      external_execution_performed: false,
    },
  }, 410);
});
