import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { verifyCounterpartyDossier } from "../_shared/counterparty-verification-v1.mjs";

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
    const dossier = body.dossier ?? body;
    const result = verifyCounterpartyDossier(dossier);

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "verify_transaction_counterparty",
      result: result.transaction_eligible ? "verified_for_transaction_candidate" : result.verification_status,
      log_level: result.transaction_eligible ? "info" : "warning",
      metadata: {
        verification_version: result.verification_version,
        role: result.role,
        legal_name: result.legal_name,
        transaction_eligible: result.transaction_eligible,
        compliance_status: result.compliance_status,
        rejection_reasons: result.rejection_reasons,
      },
    });

    return json({
      ok: true,
      ...result,
      execution_boundary: {
        company_verified_only_against_supplied_evidence: true,
        quote_executed: false,
        order_placed: false,
        contract_signed: false,
        money_moved: false,
        human_review_required: true,
      },
    });
  } catch (error) {
    console.error("verify-transaction-counterparty failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Counterparty verification failed",
    }, 500);
  }
});
