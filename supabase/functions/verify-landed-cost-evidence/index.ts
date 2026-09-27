import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { evaluateLandedCostEvidence } from "../_shared/landed-cost-evidence-v1.mjs";
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
    const input = body?.input ?? body;
    const result = evaluateLandedCostEvidence(input);

    const audit = await hashStrategicSnapshot({
      verification_version: result.verification_version,
      candidate_id: result.candidate_id,
      product_id: result.product_id,
      hs_code: result.hs_code,
      origin_country: result.origin_country,
      destination_country: result.destination_country,
      quantity: result.quantity,
      quantity_unit: result.quantity_unit,
      comparison_currency: result.comparison_currency,
      coverage_complete: result.coverage_complete,
      execution_ready_cost_stack: result.execution_ready_cost_stack,
      components: result.components,
      supplemental_landed_cost: result.supplemental_landed_cost,
      recoverable_tax_cash_flow: result.recoverable_tax_cash_flow,
      supplemental_cash_requirement: result.supplemental_cash_requirement,
      normalized_structure_costs: result.normalized_structure_costs,
      missing_execution_fields: result.missing_execution_fields,
    });

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "verify_landed_cost_evidence",
        result: result.execution_ready_cost_stack
          ? "execution_grade_cost_stack"
          : result.coverage_complete
            ? "research_complete_cost_stack"
            : "incomplete_cost_stack",
        log_level: result.coverage_complete ? "info" : "warning",
        metadata: {
          candidate_id: result.candidate_id,
          product_id: result.product_id,
          hs_code: result.hs_code,
          origin_country: result.origin_country,
          destination_country: result.destination_country,
          comparison_currency: result.comparison_currency,
          coverage_complete: result.coverage_complete,
          execution_ready_cost_stack: result.execution_ready_cost_stack,
          supplemental_landed_cost: result.supplemental_landed_cost,
          recoverable_tax_cash_flow: result.recoverable_tax_cash_flow,
          missing_categories: result.missing_categories,
          invalid_component_count: result.invalid_components.length,
          audit_hash: audit.hash,
        },
      });
    } catch (logError) {
      console.warn("landed-cost audit log unavailable", logError);
    }

    return json({
      ok: result.valid_request,
      ...result,
      audit,
      execution_boundary: {
        ...result.execution_boundary,
        transaction_eligible: false,
        human_approval_required: true,
      },
    }, result.valid_request ? 200 : 422);
  } catch (error) {
    console.error("verify-landed-cost-evidence failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Landed-cost evidence verification failed",
      execution_boundary: {
        customs_declaration_filed: false,
        insurance_bound: false,
        financing_accepted: false,
        payment_made: false,
        order_or_contract_executed: false,
      },
    }, 500);
  }
});
