import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { buildIbkrOrderPreview } from "../_shared/ibkr-order-preview-v1.mjs";
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

function maskAccount(value: string) {
  const clean = value.trim();
  if (!clean) return "masked";
  const suffix = clean.slice(-4);
  return "masked:" + suffix;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { ok: response.ok, status: response.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : null;
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

  const baseUrl = normalizeBaseUrl(Deno.env.get("IBKR_WEB_API_BASE_URL") ?? "");
  const bearerToken = (Deno.env.get("IBKR_WEB_API_BEARER_TOKEN") ?? "").trim();
  const accountId = (Deno.env.get("IBKR_ACCOUNT_ID") ?? "").trim();

  if (!baseUrl || !bearerToken || !accountId) {
    return json({
      ok: false,
      code: "ibkr_provider_not_configured",
      message: "IBKR order preview is not configured. Required server-side settings are missing.",
      required_server_settings: [
        "IBKR_WEB_API_BASE_URL",
        "IBKR_WEB_API_BEARER_TOKEN",
        "IBKR_ACCOUNT_ID",
      ],
      credentials_accepted_from_client: false,
      order_submitted: false,
    }, 503);
  }

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const candidateId = String(body.candidate_id || "").trim();
    const strategicAuditHash = String(body.strategic_audit_hash || "").trim().toLowerCase();
    const idempotencyKey = String(body.idempotency_key || "").trim();
    const orderInput = asRecord(body.order);

    const conid = numberField(orderInput, "conid");
    const quantity = numberField(orderInput, "quantity");
    const limitPrice = numberField(orderInput, "limit_price");
    const side = String(orderInput.side || "").trim().toUpperCase();

    if (!candidateId || !conid || !quantity || !limitPrice || !["BUY", "SELL"].includes(side)) {
      return json({
        ok: false,
        code: "ibkr_preview_request_invalid",
        message: "candidate_id, positive conid/quantity/limit_price and BUY/SELL side are required.",
        order_submitted: false,
      }, 400);
    }

    const providerHeaders = {
      Authorization: "Bearer " + bearerToken,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    // Fail closed if the brokerage session is not already authenticated.
    // This adapter intentionally does not compete for / initialize a trading session.
    const authStatus = await fetchJson(
      baseUrl + "/iserver/auth/status",
      { method: "GET", headers: providerHeaders },
    );
    const authRecord = asRecord(authStatus.data);
    if (!authStatus.ok || authRecord.authenticated !== true) {
      return json({
        ok: false,
        code: "ibkr_session_not_authenticated",
        message: "The configured IBKR brokerage session is not authenticated. AICIS did not initialize, compete for, or alter the session.",
        provider_status: authStatus.status,
        connected: authRecord.connected === true,
        authenticated: authRecord.authenticated === true,
        order_submitted: false,
      }, 503);
    }

    const fields = "31,84,85,86,88,6509";
    const snapshotUrl =
      baseUrl +
      "/iserver/marketdata/snapshot?conids=" +
      encodeURIComponent(String(conid)) +
      "&fields=" +
      encodeURIComponent(fields);

    // IBKR documents the first snapshot request as a pre-flight that starts
    // consumption; no trading action is performed here.
    const preflight = await fetchJson(
      snapshotUrl,
      { method: "GET", headers: providerHeaders },
    );
    if (!preflight.ok) {
      return json({
        ok: false,
        code: "ibkr_marketdata_preflight_failed",
        provider_status: preflight.status,
        order_submitted: false,
      }, 502);
    }

    const delayMsRaw = Number(Deno.env.get("IBKR_MARKETDATA_PREFLIGHT_DELAY_MS") ?? 250);
    const delayMs = Number.isFinite(delayMsRaw)
      ? Math.min(Math.max(Math.trunc(delayMsRaw), 0), 2000)
      : 250;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const snapshotResponse = await fetchJson(
      snapshotUrl,
      { method: "GET", headers: providerHeaders },
    );
    if (!snapshotResponse.ok) {
      return json({
        ok: false,
        code: "ibkr_marketdata_snapshot_failed",
        provider_status: snapshotResponse.status,
        order_submitted: false,
      }, 502);
    }

    const snapshotArray = Array.isArray(snapshotResponse.data) ? snapshotResponse.data : [];
    const snapshot = asRecord(
      snapshotArray.find((item) => Number(asRecord(item).conid) === conid) ?? snapshotArray[0],
    );

    const whatIfPayload = {
      orders: [{
        conid,
        orderType: "LMT",
        price: limitPrice,
        side,
        tif: "DAY",
        quantity,
      }],
    };

    const whatIfUrl =
      baseUrl +
      "/iserver/account/" +
      encodeURIComponent(accountId) +
      "/orders/whatif";

    const whatIfResponse = await fetchJson(
      whatIfUrl,
      {
        method: "POST",
        headers: providerHeaders,
        body: JSON.stringify(whatIfPayload),
      },
    );

    if (!whatIfResponse.ok) {
      return json({
        ok: false,
        code: "ibkr_whatif_failed",
        provider_status: whatIfResponse.status,
        order_submitted: false,
      }, 502);
    }

    const whatIfData = Array.isArray(whatIfResponse.data)
      ? asRecord(whatIfResponse.data[0])
      : asRecord(whatIfResponse.data);
    const whatIfObservedAt = new Date().toISOString();

    const snapshotAudit = await hashStrategicSnapshot(snapshot);
    const whatIfAudit = await hashStrategicSnapshot(whatIfData);

    const preview = buildIbkrOrderPreview({
      candidate_id: candidateId,
      strategic_audit_hash: strategicAuditHash,
      idempotency_key: idempotencyKey,
      account_ref: maskAccount(accountId),
      order: {
        conid,
        side,
        order_type: "LMT",
        tif: "DAY",
        quantity,
        limit_price: limitPrice,
      },
      snapshot,
      whatif: whatIfData,
      snapshot_hash: snapshotAudit.hash,
      whatif_hash: whatIfAudit.hash,
      whatif_observed_at: whatIfObservedAt,
      server_attested: true,
    });

    if (!preview.valid) {
      return json({
        ok: false,
        code: "ibkr_preview_normalization_failed",
        reasons: preview.reasons,
        preview,
        order_submitted: false,
      }, 422);
    }

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "preview_execution_ibkr",
        result: "provider_order_preview",
        log_level: "info",
        metadata: {
          candidate_id: candidateId,
          conid,
          side,
          quantity,
          quote_snapshot_hash: snapshotAudit.hash,
          whatif_hash: whatIfAudit.hash,
          strategic_audit_hash: strategicAuditHash,
          idempotency_key: idempotencyKey,
          account_ref: maskAccount(accountId),
          provider: "Interactive Brokers",
          order_submitted: false,
          money_moved: false,
        },
      });
    } catch (logError) {
      console.warn("IBKR preview audit log unavailable", logError);
    }

    return json({
      ok: true,
      preview,
      provider_audit: {
        snapshot_hash: snapshotAudit.hash,
        whatif_hash: whatIfAudit.hash,
      },
      provider_session: {
        authenticated: true,
        account_ref: maskAccount(accountId),
      },
      execution_boundary: {
        marketdata_snapshot_called: true,
        whatif_endpoint_called: true,
        place_order_endpoint_called: false,
        order_submitted: false,
        contract_signed: false,
        money_moved: false,
        external_execution_performed: false,
      },
    });
  } catch (error) {
    console.error("preview-execution-ibkr failed", error);
    return json({
      ok: false,
      code: "ibkr_preview_failed",
      error: error instanceof Error ? error.message : "IBKR preview failed",
      execution_boundary: {
        place_order_endpoint_called: false,
        order_submitted: false,
        money_moved: false,
        external_execution_performed: false,
      },
    }, 500);
  }
});
