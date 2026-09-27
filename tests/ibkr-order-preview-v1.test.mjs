
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIbkrOrderPreview,
  normalizeIbkrMarketSnapshot,
  normalizeIbkrWhatIf,
} from "../supabase/functions/_shared/ibkr-order-preview-v1.mjs";

const HASH = "e".repeat(64);

const snapshot = {
  "31": "168.42",
  "84": "168.41",
  "85": "600",
  "86": "168.42",
  "88": "1,300",
  "6509": "RpB",
  "_updated": 1712596911593,
  conid: 265598,
};

const whatif = {
  amount: {
    amount: "1,977.60 USD (10 Shares)",
    commission: "1 USD",
    total: "1,978.60 USD",
  },
  equity: {
    current: "215,415,594",
    change: "-1",
    after: "215,415,593",
  },
  initial: {
    current: "116,965",
    change: "652",
    after: "117,617",
  },
  maintenance: {
    current: "106,332",
    change: "592",
    after: "106,924",
  },
  position: {
    current: "0",
    change: "10",
    after: "10",
  },
  warn: null,
  error: null,
};

test("normalizes IBKR top-of-book snapshot fields without inventing expiry", () => {
  const result = normalizeIbkrMarketSnapshot(snapshot, 265598);
  assert.equal(result.valid, true);
  assert.equal(result.snapshot.bid, 168.41);
  assert.equal(result.snapshot.ask, 168.42);
  assert.equal(result.snapshot.ask_size, 600);
  assert.equal(result.snapshot.bid_size, 1300);
  assert.equal(result.snapshot.market_data_availability, "RpB");
  assert.equal(result.snapshot.freshness_semantics, "provider_snapshot_timestamp_no_provider_quote_expiry");
});

test("normalizes official what-if commission and margin response", () => {
  const result = normalizeIbkrWhatIf(whatif);
  assert.equal(result.valid, true);
  assert.equal(result.preview.order_amount, 1977.6);
  assert.equal(result.preview.commission, 1);
  assert.equal(result.preview.total, 1978.6);
  assert.equal(result.preview.currency, "USD");
  assert.equal(result.preview.initial_margin.change, 652);
  assert.equal(result.preview.maintenance_margin.change, 592);
});

test("server-attested what-if becomes provider order preview but never execution", () => {
  const result = buildIbkrOrderPreview({
    candidate_id: "candidate-1",
    strategic_audit_hash: HASH,
    idempotency_key: "ibkr-preview:00000001",
    account_ref: "masked:4567",
    order: {
      conid: 265598,
      side: "BUY",
      order_type: "LMT",
      tif: "DAY",
      quantity: 10,
      limit_price: 200.25,
    },
    snapshot,
    whatif,
    snapshot_hash: HASH,
    whatif_hash: "f".repeat(64),
    whatif_observed_at: "2026-09-27T14:02:00Z",
    server_attested: true,
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "provider_order_preview");
  assert.equal(result.provider.server_attested, true);
  assert.equal(result.execution_boundary.whatif_endpoint_called, true);
  assert.equal(result.execution_boundary.order_endpoint_called, false);
  assert.equal(result.execution_boundary.order_submitted, false);
  assert.equal(result.execution_boundary.money_moved, false);
  assert.equal(result.approval.approval_token, null);
  assert.equal(result.provider_preview.observed_at, "2026-09-27T14:02:00.000Z");
});

test("unattested what-if payload remains research-only", () => {
  const result = buildIbkrOrderPreview({
    candidate_id: "candidate-1",
    strategic_audit_hash: HASH,
    idempotency_key: "ibkr-preview:00000002",
    account_ref: "masked:4567",
    order: {
      conid: 265598,
      side: "BUY",
      order_type: "LMT",
      tif: "DAY",
      quantity: 10,
      limit_price: 200.25,
    },
    snapshot,
    whatif,
    snapshot_hash: HASH,
    whatif_hash: "f".repeat(64),
    whatif_observed_at: "2026-09-27T14:02:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "unattested_provider_preview");
  assert.equal(result.provider.server_attested, false);
  assert.equal(result.execution_boundary.whatif_endpoint_called, false);
});

test("provider error fails closed", () => {
  const result = normalizeIbkrWhatIf({
    ...whatif,
    error: "Order not allowed",
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("provider_whatif_error"));
});

test("v1 adapter refuses market orders and non-DAY tif", () => {
  const result = buildIbkrOrderPreview({
    candidate_id: "candidate-1",
    strategic_audit_hash: HASH,
    idempotency_key: "ibkr-preview:00000003",
    account_ref: "masked:4567",
    order: {
      conid: 265598,
      side: "BUY",
      order_type: "MKT",
      tif: "GTC",
      quantity: 10,
      limit_price: 200.25,
    },
    snapshot,
    whatif,
    snapshot_hash: HASH,
    whatif_hash: "f".repeat(64),
    whatif_observed_at: "2026-09-27T14:02:00Z",
    server_attested: true,
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("only_limit_orders_supported_in_v1_preview"));
  assert.ok(result.reasons.includes("only_day_tif_supported_in_v1_preview"));
});

test("snapshot conid mismatch fails closed", () => {
  const result = normalizeIbkrMarketSnapshot(snapshot, 999999);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("snapshot_conid_mismatch"));
});
