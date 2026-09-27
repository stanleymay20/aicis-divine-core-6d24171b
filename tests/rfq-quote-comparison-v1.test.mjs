
import test from "node:test";
import assert from "node:assert/strict";
import { compareRfqResponses } from "../supabase/functions/_shared/rfq-quote-comparison-v1.mjs";

const HASH = "b".repeat(64);
const ref = (id) => [{ source_id: id, observed_at: "2026-09-27T15:00:00Z", sha256: HASH }];

function quote(id, unitPrice, extraCost) {
  return {
    id,
    rfq_id: "rfq:cocoa",
    evidence_status: "rfq_response_unverified",
    name: "Supplier " + id,
    product_id: "cocoa",
    requested_quantity: 10,
    requested_quantity_unit: "tonnes",
    unit_price: unitPrice,
    currency: "EUR",
    incoterm: "CIF",
    named_place_or_port: "Hamburg",
    payment_terms: "LC at sight",
    lead_time_days: 18,
    cost_completeness: "full_landed_cost",
    quote_valid_until: "2026-10-02T12:00:00Z",
    evidence_refs: ref("quote-" + id),
    additional_costs: [{
      type: "inspection",
      amount: extraCost,
      basis: "fixed",
      currency: "EUR",
      evidence_refs: ref("cost-" + id),
    }],
  };
}

test("ranks only fully comparable full-landed-cost responses", () => {
  const result = compareRfqResponses({
    responses: [
      quote("A", 3000, 1000),
      quote("B", 3050, 200),
    ],
    comparison_currency: "EUR",
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, true);
  assert.equal(result.quotes[0].quote_id, "B");
  assert.equal(result.quotes[0].total_comparable_cost, 30700);
  assert.equal(result.quotes[1].quote_id, "A");
  assert.equal(result.quotes[1].total_comparable_cost, 31000);
  assert.equal(result.lowest_evaluated_landed_cost_response.quote_id, "B");
  assert.equal(result.transaction_eligible, false);
});

test("cheaper unit price can lose after evidenced additional costs", () => {
  const result = compareRfqResponses({
    responses: [
      quote("cheap-unit", 2900, 3000),
      quote("higher-unit", 3050, 500),
    ],
    comparison_currency: "EUR",
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, true);
  assert.equal(result.lowest_evaluated_landed_cost_response.quote_id, "higher-unit");
});

test("different Incoterms block winner selection", () => {
  const a = quote("A", 3000, 1000);
  const b = quote("B", 3050, 200);
  b.incoterm = "FOB";
  const result = compareRfqResponses({
    responses: [a, b],
    comparison_currency: "EUR",
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, false);
  assert.ok(result.blocking_reasons.includes("incoterm_mismatch"));
  assert.equal(result.lowest_evaluated_landed_cost_response, null);
});

test("quoted-price-only responses cannot produce a landed-cost winner", () => {
  const a = quote("A", 3000, 0);
  const b = quote("B", 2900, 0);
  a.cost_completeness = "quoted_price_only";
  b.cost_completeness = "quoted_price_only";
  const result = compareRfqResponses({
    responses: [a, b],
    comparison_currency: "EUR",
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, false);
  assert.ok(result.blocking_reasons.includes("full_landed_cost_required_for_winner"));
});

test("mixed currencies fail closed without verified FX", () => {
  const a = quote("A", 3000, 1000);
  const b = quote("B", 3600, 200);
  b.currency = "USD";
  b.additional_costs[0].currency = "USD";

  const result = compareRfqResponses({
    responses: [a, b],
    comparison_currency: "EUR",
    fx_rates: [],
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, false);
  assert.ok(result.quotes.some((item) => item.reasons.includes("quote_currency_not_normalized")));
});

test("verified FX enables mixed-currency research comparison", () => {
  const a = quote("A", 3000, 1000);
  const b = quote("B", 3600, 240);
  b.currency = "USD";
  b.additional_costs[0].currency = "USD";

  const result = compareRfqResponses({
    responses: [a, b],
    comparison_currency: "EUR",
    fx_rates: [{
      id: "eur-usd",
      base_currency: "EUR",
      quote_currency: "USD",
      rate: 1.2,
      observed_at: "2026-09-27T15:00:00Z",
      valid_until: "2026-09-27T18:00:00Z",
      evidence_status: "verified_market",
      provider: "verified-provider",
      evidence_refs: ref("fx"),
    }],
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, true);
  assert.equal(result.quotes.length, 2);
  assert.ok(result.quotes[1].fx_evidence_refs.length > 0 || result.quotes[0].fx_evidence_refs.length > 0);
});

test("different quantities block comparison rather than normalizing silently", () => {
  const a = quote("A", 3000, 1000);
  const b = quote("B", 3050, 200);
  b.requested_quantity = 20;

  const result = compareRfqResponses({
    responses: [a, b],
    comparison_currency: "EUR",
    as_of: "2026-09-27T16:00:00Z",
  });

  assert.equal(result.ordering_allowed, false);
  assert.ok(result.blocking_reasons.includes("quantity_mismatch"));
});
