
export const IBKR_ORDER_PREVIEW_VERSION = "aicis-ibkr-order-preview-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clean = (value) => String(value ?? "").trim();

function parseNumberText(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = clean(value);
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function currencyFromText(value) {
  const text = clean(value).toUpperCase();
  const match = text.match(/\b[A-Z]{3}\b/);
  return match ? match[0] : null;
}

function isoFromEpochMs(value) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!finite(parsed) || parsed <= 0) return null;
  const date = new Date(parsed);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeIbkrMarketSnapshot(snapshot = {}, expectedConid = null) {
  const conid = Number(snapshot.conid);
  const reasons = [];

  if (!Number.isInteger(conid) || conid <= 0) reasons.push("snapshot_conid_invalid");
  if (expectedConid != null && conid !== Number(expectedConid)) reasons.push("snapshot_conid_mismatch");

  const observedAt = isoFromEpochMs(snapshot._updated);
  if (!observedAt) reasons.push("snapshot_updated_at_invalid");

  const bid = parseNumberText(snapshot["84"]);
  const ask = parseNumberText(snapshot["86"]);
  const last = parseNumberText(snapshot["31"]);
  const askSize = parseNumberText(snapshot["85"]);
  const bidSize = parseNumberText(snapshot["88"]);
  const availability = clean(snapshot["6509"]) || null;

  if (bid == null && ask == null && last == null) reasons.push("snapshot_price_fields_missing");

  return {
    valid: reasons.length === 0,
    reasons,
    snapshot: {
      conid: Number.isInteger(conid) && conid > 0 ? conid : null,
      observed_at: observedAt,
      bid,
      ask,
      last,
      ask_size: askSize,
      bid_size: bidSize,
      market_data_availability: availability,
      provider: "Interactive Brokers",
      freshness_semantics: "provider_snapshot_timestamp_no_provider_quote_expiry",
    },
  };
}

export function normalizeIbkrWhatIf(response = {}) {
  const amount = response.amount && typeof response.amount === "object" ? response.amount : {};
  const equity = response.equity && typeof response.equity === "object" ? response.equity : {};
  const initial = response.initial && typeof response.initial === "object" ? response.initial : {};
  const maintenance = response.maintenance && typeof response.maintenance === "object" ? response.maintenance : {};
  const position = response.position && typeof response.position === "object" ? response.position : {};

  const amountValue = parseNumberText(amount.amount);
  const commission = parseNumberText(amount.commission);
  const total = parseNumberText(amount.total);
  const currency = currencyFromText(amount.total) || currencyFromText(amount.amount) || currencyFromText(amount.commission);
  const providerError = clean(response.error) || null;
  const providerWarning = clean(response.warn) || null;

  const reasons = [];
  if (providerError) reasons.push("provider_whatif_error");
  if (amountValue == null) reasons.push("whatif_amount_missing");
  if (commission == null) reasons.push("whatif_commission_missing");
  if (total == null) reasons.push("whatif_total_missing");
  if (!currency) reasons.push("whatif_currency_missing");

  return {
    valid: reasons.length === 0,
    reasons,
    preview: {
      order_amount: amountValue,
      commission,
      total,
      currency,
      equity: {
        current: parseNumberText(equity.current),
        change: parseNumberText(equity.change),
        after: parseNumberText(equity.after),
      },
      initial_margin: {
        current: parseNumberText(initial.current),
        change: parseNumberText(initial.change),
        after: parseNumberText(initial.after),
      },
      maintenance_margin: {
        current: parseNumberText(maintenance.current),
        change: parseNumberText(maintenance.change),
        after: parseNumberText(maintenance.after),
      },
      position: {
        current: parseNumberText(position.current),
        change: parseNumberText(position.change),
        after: parseNumberText(position.after),
      },
      warning: providerWarning,
      error: providerError,
    },
  };
}

export function buildIbkrOrderPreview({
  candidate_id = "",
  strategic_audit_hash = "",
  idempotency_key = "",
  account_ref = "",
  order = {},
  snapshot = {},
  whatif = {},
  snapshot_hash = "",
  whatif_hash = "",
  whatif_observed_at = "",
  server_attested = false,
} = {}) {
  const reasons = [];
  const candidateId = clean(candidate_id);
  const auditHash = clean(strategic_audit_hash).toLowerCase();
  const idem = clean(idempotency_key);
  const conid = Number(order.conid);
  const side = clean(order.side).toUpperCase();
  const orderType = clean(order.order_type || order.orderType).toUpperCase();
  const tif = clean(order.tif || "DAY").toUpperCase();
  const quantity = Number(order.quantity);
  const limitPrice = Number(order.limit_price ?? order.price);

  if (!candidateId) reasons.push("candidate_id_missing");
  if (!SHA256.test(auditHash)) reasons.push("strategic_audit_hash_invalid");
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idem)) reasons.push("idempotency_key_invalid");
  if (!Number.isInteger(conid) || conid <= 0) reasons.push("conid_invalid");
  if (!["BUY", "SELL"].includes(side)) reasons.push("side_invalid");
  if (orderType !== "LMT") reasons.push("only_limit_orders_supported_in_v1_preview");
  if (tif !== "DAY") reasons.push("only_day_tif_supported_in_v1_preview");
  if (!finite(quantity) || quantity <= 0) reasons.push("quantity_invalid");
  if (!finite(limitPrice) || limitPrice <= 0) reasons.push("limit_price_invalid");
  if (!clean(account_ref)) reasons.push("account_ref_missing");
  if (!SHA256.test(clean(snapshot_hash))) reasons.push("snapshot_hash_invalid");
  if (!SHA256.test(clean(whatif_hash))) reasons.push("whatif_hash_invalid");
  const whatIfObservedAt = Date.parse(whatif_observed_at);
  if (!Number.isFinite(whatIfObservedAt)) reasons.push("whatif_observed_at_invalid");

  const snapshotResult = normalizeIbkrMarketSnapshot(snapshot, conid);
  const whatifResult = normalizeIbkrWhatIf(whatif);
  reasons.push(...snapshotResult.reasons, ...whatifResult.reasons);

  const valid = reasons.length === 0;
  const attested = valid && server_attested === true;

  return {
    adapter_version: IBKR_ORDER_PREVIEW_VERSION,
    valid,
    reasons: [...new Set(reasons)],
    preview_status: !valid
      ? "rejected"
      : attested
        ? "provider_order_preview"
        : "unattested_provider_preview",
    provider: {
      name: "Interactive Brokers",
      capability: "order_preview_only",
      server_attested: attested,
      account_ref: clean(account_ref) || null,
    },
    candidate: {
      candidate_id: candidateId || null,
      strategic_audit_hash: SHA256.test(auditHash) ? auditHash : null,
    },
    order: {
      conid: Number.isInteger(conid) && conid > 0 ? conid : null,
      side: side || null,
      order_type: orderType || null,
      tif: tif || null,
      quantity: finite(quantity) ? quantity : null,
      limit_price: finite(limitPrice) ? limitPrice : null,
    },
    market_snapshot: snapshotResult.snapshot,
    provider_preview: {
      ...whatifResult.preview,
      observed_at: Number.isFinite(whatIfObservedAt)
        ? new Date(whatIfObservedAt).toISOString()
        : null,
    },
    evidence_refs: valid
      ? [
          {
            source_id: "ibkr:market-snapshot:" + conid,
            observed_at: snapshotResult.snapshot.observed_at,
            sha256: clean(snapshot_hash),
          },
          {
            source_id: "ibkr:order-whatif:" + conid,
            observed_at: Number.isFinite(whatIfObservedAt)
              ? new Date(whatIfObservedAt).toISOString()
              : null,
            sha256: clean(whatif_hash),
          },
        ]
      : [],
    idempotency_key: idem || null,
    approval: {
      human_approval_required: true,
      approval_status: "not_approved",
      approval_token: null,
      executable_action_available: false,
    },
    execution_boundary: {
      order_endpoint_called: false,
      whatif_endpoint_called: attested,
      wallet_or_cash_mutated: false,
      order_submitted: false,
      money_moved: false,
      external_execution_performed: false,
    },
    semantics: attested
      ? "provider_attested_whatif_preview_not_order_submission"
      : "unattested_whatif_payload_research_only",
  };
}
