
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExecutionPreview,
  validateExecutionQuote,
} from "../supabase/functions/_shared/execution-quote-contract-v1.mjs";
import { validateFxRate } from "../supabase/functions/_shared/verified-fx-v1.mjs";

const HASH = "d".repeat(64);
const evidence = (id = "quote-source") => [{
  source_id: id,
  observed_at: "2026-09-27T14:00:00Z",
  sha256: HASH,
}];

const candidate = {
  candidate_id: "tx:cocoa",
  title: "Cocoa transaction",
  transaction_type: "physical_trade",
  execution_ready: true,
  currency: "EUR",
  capital_required: 35000,
};

const securityQuote = {
  quote_id: "q-1",
  provider_quote_id: "provider-q-1",
  provider_name: "Example Broker",
  provider_adapter: "example-broker-v1",
  status: "executable_quote",
  observed_at: "2026-09-27T14:00:00Z",
  valid_until: "2026-09-27T14:05:00Z",
  instrument: { kind: "security", symbol: "ABC" },
  execution_context: { candidate_id: "tx:cocoa", purpose: "primary_transaction" },
  side: "buy",
  quantity: 10,
  quantity_unit: "shares",
  pricing: { ask: 101.25, bid: 101.2, currency: "EUR" },
  costs: [
    { type: "commission", amount: 2.5, currency: "EUR" },
    { type: "slippage_estimate", amount: 1.5, currency: "EUR" },
  ],
  account_context: { provider_account_ref: "masked:1234", account_type: "cash" },
  evidence_refs: evidence(),
};

test("valid executable quote produces preview but never execution", () => {
  const result = buildExecutionPreview({
    candidate,
    quote: securityQuote,
    strategic_audit_hash: HASH,
    idempotency_key: "preview:security:0001",
    provider_attested: true,
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "previewed_order");
  assert.equal(result.quote.selected_price, 101.25);
  assert.equal(result.quote.selected_price_source, "ask");
  assert.equal(result.economics.gross_notional, 1012.5);
  assert.equal(result.economics.estimated_costs_total, 4);
  assert.equal(result.economics.estimated_cash_required, 1016.5);
  assert.equal(result.approval.human_approval_package_ready, true);
  assert.equal(result.approval.approved, false);
  assert.equal(result.execution_boundary.order_submitted, false);
  assert.equal(result.execution_boundary.money_moved, false);
});

test("indicative quote remains non-executable even when otherwise complete", () => {
  const result = buildExecutionPreview({
    candidate,
    quote: { ...securityQuote, status: "indicative" },
    strategic_audit_hash: HASH,
    idempotency_key: "preview:indicative:01",
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "indicative_only");
  assert.equal(result.approval.human_approval_package_ready, false);
});

test("expired executable quote fails closed", () => {
  const result = buildExecutionPreview({
    candidate,
    quote: { ...securityQuote, valid_until: "2026-09-27T14:00:30Z" },
    strategic_audit_hash: HASH,
    idempotency_key: "preview:expired:0001",
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("quote_stale_or_future"));
  assert.equal(result.preview_status, "rejected");
});

test("quote without provenance fails closed", () => {
  const validation = validateExecutionQuote({
    ...securityQuote,
    evidence_refs: [],
  }, "2026-09-27T14:01:00Z");

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("quote_evidence_invalid"));
});

test("secret-bearing provider payload is rejected", () => {
  const validation = validateExecutionQuote({
    ...securityQuote,
    account_context: {
      provider_account_ref: "masked:1234",
      api_key: "should-never-be-here",
    },
  }, "2026-09-27T14:01:00Z");

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.some((reason) => reason.startsWith("secret_material_forbidden:")));
});

test("mixed-currency cost entries fail closed instead of assuming FX", () => {
  const validation = validateExecutionQuote({
    ...securityQuote,
    costs: [{ type: "commission", amount: 2, currency: "USD" }],
  }, "2026-09-27T14:01:00Z");

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("cost_currency_must_match_quote_currency"));
});

test("candidate not yet execution-ready can be previewed but requires rebuild", () => {
  const result = buildExecutionPreview({
    candidate: { ...candidate, execution_ready: false },
    quote: securityQuote,
    strategic_audit_hash: HASH,
    idempotency_key: "preview:rebuild:0001",
    provider_attested: true,
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "previewed_order");
  assert.equal(result.approval.human_approval_package_ready, false);
  assert.equal(result.approval.rebuild_required_before_approval, true);
});

test("executable FX quote emits existing verified-FX schema", () => {
  const quote = {
    quote_id: "fx-q-1",
    provider_quote_id: "fx-provider-q-1",
    provider_name: "Example FX Provider",
    provider_adapter: "example-fx-v1",
    status: "executable_quote",
    observed_at: "2026-09-27T14:00:00Z",
    valid_until: "2026-09-27T14:03:00Z",
    instrument: {
      kind: "fx",
      base_currency: "USD",
      quote_currency: "EUR",
      symbol: "USD/EUR",
    },
    execution_context: { candidate_id: "tx:cocoa", purpose: "fx_conversion" },
    side: "convert",
    quantity: 1000,
    quantity_unit: "USD",
    pricing: { rate: 0.85, currency: "EUR" },
    costs: [],
    evidence_refs: evidence("fx-executable-source"),
  };

  const result = buildExecutionPreview({
    candidate: { ...candidate, execution_ready: false },
    quote,
    strategic_audit_hash: HASH,
    idempotency_key: "preview:fx:00000001",
    provider_attested: true,
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.normalized_fx_rate.evidence_status, "executable_quote");
  assert.equal(result.normalized_fx_rate.base_currency, "USD");
  assert.equal(result.normalized_fx_rate.quote_currency, "EUR");
  assert.equal(result.normalized_fx_rate.rate, 0.85);

  const fxValidation = validateFxRate(result.normalized_fx_rate, "2026-09-27T14:01:00Z");
  assert.equal(fxValidation.valid, true);
});

test("idempotency key is mandatory and constrained", () => {
  const result = buildExecutionPreview({
    candidate,
    quote: securityQuote,
    strategic_audit_hash: HASH,
    idempotency_key: "short",
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("idempotency_key_invalid"));
});

test("FX quote cannot pretend to be a buy order", () => {
  const quote = {
    ...securityQuote,
    quote_id: "fx-bad",
    provider_quote_id: "fx-bad-provider",
    instrument: { kind: "fx", base_currency: "USD", quote_currency: "EUR" },
    execution_context: { candidate_id: "tx:cocoa", purpose: "fx_conversion" },
    side: "buy",
    quantity: 1000,
    quantity_unit: "USD",
    pricing: { rate: 0.85, currency: "EUR" },
  };
  const validation = validateExecutionQuote(quote, "2026-09-27T14:01:00Z");
  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("fx_side_must_be_convert"));
});


test("quote candidate binding mismatch fails closed", () => {
  const result = buildExecutionPreview({
    candidate,
    quote: {
      ...securityQuote,
      execution_context: { candidate_id: "tx:other", purpose: "primary_transaction" },
    },
    strategic_audit_hash: HASH,
    idempotency_key: "preview:mismatch:001",
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("quote_candidate_binding_mismatch"));
});

test("FX quote with explicit costs is previewable but cannot be injected as a bare rate", () => {
  const quote = {
    quote_id: "fx-cost-q-1",
    provider_quote_id: "fx-cost-provider-q-1",
    provider_name: "Example FX Provider",
    provider_adapter: "example-fx-v1",
    status: "executable_quote",
    observed_at: "2026-09-27T14:00:00Z",
    valid_until: "2026-09-27T14:03:00Z",
    instrument: {
      kind: "fx",
      base_currency: "USD",
      quote_currency: "EUR",
      symbol: "USD/EUR",
    },
    execution_context: { candidate_id: "tx:cocoa", purpose: "fx_conversion" },
    side: "convert",
    quantity: 1000,
    quantity_unit: "USD",
    pricing: { rate: 0.85, currency: "EUR" },
    costs: [{ type: "commission", amount: 1.5, currency: "EUR" }],
    evidence_refs: evidence("fx-cost-source"),
  };

  const result = buildExecutionPreview({
    candidate: { ...candidate, execution_ready: false },
    quote,
    strategic_audit_hash: HASH,
    idempotency_key: "preview:fx:withcost1",
    provider_attested: true,
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "previewed_order");
  assert.equal(result.normalized_fx_rate, null);
  assert.equal(result.fx_handoff_blocked_reason, "explicit_fx_costs_require_transaction_cost_integration");
});

test("FX quote purpose must be explicit and correct", () => {
  const validation = validateExecutionQuote({
    ...securityQuote,
    quote_id: "fx-purpose-bad",
    provider_quote_id: "fx-purpose-provider",
    instrument: { kind: "fx", base_currency: "USD", quote_currency: "EUR" },
    execution_context: { candidate_id: "tx:cocoa", purpose: "primary_transaction" },
    side: "convert",
    quantity: 1000,
    quantity_unit: "USD",
    pricing: { rate: 0.85, currency: "EUR" },
    costs: [],
  }, "2026-09-27T14:01:00Z");

  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("fx_quote_purpose_must_be_fx_conversion"));
});


test("unattested executable claim remains research-only", () => {
  const result = buildExecutionPreview({
    candidate,
    quote: securityQuote,
    strategic_audit_hash: HASH,
    idempotency_key: "preview:unattested:1",
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "unattested_quote");
  assert.equal(result.provider_attestation.attested, false);
  assert.equal(result.approval.human_approval_package_ready, false);
  assert.equal(result.normalized_fx_rate, null);
  assert.equal(result.execution_boundary.order_submitted, false);
});

test("unattested FX claim cannot enter the verified FX layer", () => {
  const quote = {
    quote_id: "fx-unattested",
    provider_quote_id: "fx-unattested-provider",
    provider_name: "Claimed FX Provider",
    provider_adapter: "claimed-fx-v1",
    status: "executable_quote",
    observed_at: "2026-09-27T14:00:00Z",
    valid_until: "2026-09-27T14:03:00Z",
    instrument: { kind: "fx", base_currency: "USD", quote_currency: "EUR" },
    execution_context: { candidate_id: "tx:cocoa", purpose: "fx_conversion" },
    side: "convert",
    quantity: 1000,
    quantity_unit: "USD",
    pricing: { rate: 0.85, currency: "EUR" },
    costs: [],
    evidence_refs: evidence("fx-unattested-source"),
  };

  const result = buildExecutionPreview({
    candidate: { ...candidate, execution_ready: false },
    quote,
    strategic_audit_hash: HASH,
    idempotency_key: "preview:fx:unattest1",
    as_of: "2026-09-27T14:01:00Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preview_status, "unattested_quote");
  assert.equal(result.normalized_fx_rate, null);
});
