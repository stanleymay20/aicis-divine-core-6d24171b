import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { compareRfqResponses } from "../_shared/rfq-quote-comparison-v1.mjs";
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
    const strategicAuditHash = String(body?.strategic_audit_hash || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(strategicAuditHash)) {
      return json({ ok: false, error: "valid strategic_audit_hash is required" }, 400);
    }

    const result = compareRfqResponses({
      responses: Array.isArray(body?.responses) ? body.responses : [],
      comparison_currency: body?.comparison_currency,
      fx_rates: Array.isArray(body?.fx_rates) ? body.fx_rates : [],
      as_of: typeof body?.as_of === "string" ? body.as_of : new Date().toISOString(),
    });

    if (result.quote_count < 2) {
      return json({
        ok: false,
        code: "insufficient_rfq_responses",
        ...result,
      }, 422);
    }

    const audit = await hashStrategicSnapshot({
      strategic_audit_hash: strategicAuditHash,
      comparison_version: result.comparison_version,
      comparison_currency: result.comparison_currency,
      blocking_reasons: result.blocking_reasons,
      quotes: result.quotes,
      lowest_evaluated_landed_cost_response: result.lowest_evaluated_landed_cost_response,
      transaction_eligible: false,
    });

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "compare_rfq_responses",
        result: result.ordering_allowed ? "research_ordering_available" : "comparison_blocked",
        log_level: result.ordering_allowed ? "info" : "warning",
        metadata: {
          strategic_audit_hash: strategicAuditHash,
          comparison_hash: audit.hash,
          quote_count: result.quote_count,
          comparison_currency: result.comparison_currency,
          ordering_allowed: result.ordering_allowed,
          blocking_reasons: result.blocking_reasons,
          transaction_eligible: false,
        },
      });
    } catch (logError) {
      console.warn("RFQ comparison audit log unavailable", logError);
    }

    return json({
      ok: true,
      ...result,
      audit,
      execution_boundary: {
        supplier_selected_for_execution: false,
        transaction_eligible: false,
        purchase_order_created: false,
        contract_signed: false,
        money_moved: false,
      },
    });
  } catch (error) {
    console.error("compare-rfq-responses failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "RFQ comparison failed",
      transaction_eligible: false,
    }, 500);
  }
});
