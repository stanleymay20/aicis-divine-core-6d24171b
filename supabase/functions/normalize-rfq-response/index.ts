import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { normalizeRfqResponse } from "../_shared/rfq-contract-v1.mjs";
import { hashStrategicSnapshot } from "../_shared/strategic-audit-v1.mjs";

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
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const input = body?.response ?? body;
    const asOf = typeof body?.as_of === "string" ? body.as_of : new Date().toISOString();
    const result = normalizeRfqResponse(input, asOf);

    if (!result.valid || !result.normalized_response) {
      return json({
        ok: false,
        code: "rfq_response_rejected",
        reasons: result.reasons,
        transaction_eligible: false,
      }, 422);
    }

    const audit = await hashStrategicSnapshot({
      contract_version: result.contract_version,
      normalized_response: result.normalized_response,
      next_required_gate: result.next_required_gate,
      transaction_eligible: false,
    });

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "normalize_rfq_response",
        result: "rfq_response_unverified",
        log_level: "info",
        metadata: {
          rfq_id: result.normalized_response.rfq_id,
          quote_id: result.normalized_response.id,
          counterparty_name: result.normalized_response.name,
          response_hash: audit.hash,
          transaction_eligible: false,
          next_required_gate: result.next_required_gate,
        },
      });
    } catch (logError) {
      console.warn("RFQ response audit log unavailable", logError);
    }

    return json({
      ok: true,
      ...result,
      audit,
      verification_boundary: {
        counterparty_reverification_required: true,
        commercial_quote_verification_required: true,
        transaction_eligible: false,
        order_created: false,
        contract_signed: false,
        money_moved: false,
      },
    });
  } catch (error) {
    console.error("normalize-rfq-response failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "RFQ response normalization failed",
      transaction_eligible: false,
    }, 500);
  }
});
