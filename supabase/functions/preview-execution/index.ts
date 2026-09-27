import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { buildExecutionPreview } from "../_shared/execution-quote-contract-v1.mjs";
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
    const body = asRecord(await req.json().catch(() => ({})));
    const candidate = asRecord(body.candidate);
    const quote = asRecord(body.quote);
    const strategicAuditHash = String(body.strategic_audit_hash || "").trim().toLowerCase();
    const idempotencyKey = String(body.idempotency_key || "").trim();
    const asOf = typeof body.as_of === "string" && body.as_of.trim()
      ? body.as_of.trim()
      : new Date().toISOString();

    const preview = buildExecutionPreview({
      candidate,
      quote,
      strategic_audit_hash: strategicAuditHash,
      idempotency_key: idempotencyKey,
      as_of: asOf,
    });

    if (!preview.valid) {
      return json({
        ok: false,
        code: "execution_preview_rejected",
        reasons: preview.reasons,
        preview,
        execution_boundary: preview.execution_boundary,
      }, 422);
    }

    const quoteAudit = await hashStrategicSnapshot(preview.quote);
    const previewAudit = await hashStrategicSnapshot({
      strategic_audit_hash: strategicAuditHash,
      candidate: preview.candidate,
      quote_hash: quoteAudit.hash,
      economics: preview.economics,
      normalized_fx_rate: preview.normalized_fx_rate,
      approval: preview.approval,
      idempotency: preview.idempotency,
      execution_boundary: preview.execution_boundary,
      preview_status: preview.preview_status,
      as_of: asOf,
    });

    const approvalRequest = preview.preview_status === "previewed_order"
      ? {
          approval_request_id: "apr:" + previewAudit.hash.slice(0, 32),
          approval_status: "not_approved",
          ready_for_human_review: preview.approval.human_approval_package_ready === true,
          rebuild_required_before_approval: preview.approval.rebuild_required_before_approval === true,
          strategic_audit_hash: strategicAuditHash,
          preview_hash: previewAudit.hash,
          quote_hash: quoteAudit.hash,
          candidate_id: preview.candidate.candidate_id,
          quote_id: preview.quote.quote_id,
          provider_quote_id: preview.quote.provider_quote_id,
          quote_valid_until: preview.quote.valid_until,
          idempotency_key: idempotencyKey,
          human_approval_required: true,
          approval_token: null,
          executable_action_available: false,
          semantics: "human_review_request_not_authorization_and_not_execution",
        }
      : null;

    // Logging is best-effort and intentionally excludes the provider payload,
    // account context, prices beyond high-level totals, or any secret material.
    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "preview_execution",
        result: preview.preview_status,
        log_level: "info",
        metadata: {
          candidate_id: preview.candidate.candidate_id,
          transaction_type: preview.candidate.transaction_type,
          quote_id: preview.quote.quote_id,
          provider_name: preview.quote.provider_name,
          quote_status: preview.quote.status,
          quote_hash: quoteAudit.hash,
          preview_hash: previewAudit.hash,
          strategic_audit_hash: strategicAuditHash,
          idempotency_key: idempotencyKey,
          human_approval_package_ready: preview.approval.human_approval_package_ready,
          rebuild_required_before_approval: preview.approval.rebuild_required_before_approval,
          order_submitted: false,
          money_moved: false,
        },
      });
    } catch (logError) {
      console.warn("preview-execution audit log unavailable", logError);
    }

    return json({
      ok: true,
      preview,
      audit: {
        quote: quoteAudit,
        preview: previewAudit,
      },
      approval_request: approvalRequest,
      provider_adapter_boundary: {
        quote_input_must_already_be_normalized_by_a_trusted_provider_adapter: true,
        arbitrary_provider_fetch_performed: false,
        provider_credentials_accepted_in_request: false,
      },
      execution_boundary: {
        provider_submission_enabled: false,
        order_submitted: false,
        contract_signed: false,
        money_moved: false,
        external_execution_performed: false,
      },
    });
  } catch (error) {
    console.error("preview-execution failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Execution preview failed",
      execution_boundary: {
        provider_submission_enabled: false,
        order_submitted: false,
        contract_signed: false,
        money_moved: false,
        external_execution_performed: false,
      },
    }, 500);
  }
});
