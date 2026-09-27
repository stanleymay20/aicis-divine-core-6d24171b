import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { buildRfqDraft } from "../_shared/rfq-contract-v1.mjs";
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
    const asOf = typeof body?.as_of === "string" ? body.as_of : new Date().toISOString();
    const result = buildRfqDraft(input, asOf);

    if (!result.valid || !result.draft) {
      return json({
        ok: false,
        code: "rfq_draft_rejected",
        reasons: result.reasons,
        approval: result.approval,
        execution_boundary: result.execution_boundary,
      }, 422);
    }

    const audit = await hashStrategicSnapshot({
      contract_version: result.contract_version,
      draft: result.draft,
      approval: result.approval,
      execution_boundary: result.execution_boundary,
    });

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "generate_rfq_draft",
        result: "draft_created_not_sent",
        log_level: "info",
        metadata: {
          rfq_id: result.draft.rfq_id,
          candidate_id: result.draft.candidate_id,
          counterparty_id: result.draft.counterparty.id,
          counterparty_role: result.draft.counterparty.role,
          rfq_hash: audit.hash,
          approved_to_send: false,
          sent: false,
        },
      });
    } catch (logError) {
      console.warn("RFQ draft audit log unavailable", logError);
    }

    return json({
      ok: true,
      ...result,
      audit,
      send_boundary: {
        outbound_provider_configured: false,
        outbound_message_sent: false,
        approved_to_send: false,
        approval_token: null,
      },
    });
  } catch (error) {
    console.error("generate-rfq-draft failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "RFQ draft generation failed",
      send_boundary: {
        outbound_message_sent: false,
        approved_to_send: false,
      },
    }, 500);
  }
});
