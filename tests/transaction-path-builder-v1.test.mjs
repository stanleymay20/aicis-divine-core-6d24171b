import test from "node:test";
import assert from "node:assert/strict";
import { buildTransactionPaths } from "../supabase/functions/_shared/transaction-path-builder-v1.mjs";

const HASH = "a".repeat(64);
const ref = (source_id) => [{ source_id, observed_at: "2026-09-27T05:00:00Z", sha256: HASH }];

function baseInput() {
  return {
    as_of: "2026-09-27T06:00:00Z",
    signal: { id: "sig-1", domain: "supply_chain", sectors: ["agriculture"] },
    product: { id: "cocoa-beans", name: "Cocoa beans", unit: "tonne", sectors: ["agriculture"], tags: ["cocoa"] },
    quantity: 10,
    source_offers: [
      {
        id: "src-cheap",
        name: "Supplier Cheap",
        country: "Ghana",
        unit_price: 3000,
        currency: "EUR",
        min_quantity: 1,
        max_quantity: 50,
        evidence_status: "verified_quote",
        evidence_score: 85,
        compliance_status: "clear",
        counterparty_quality_score: 62,
        quote_valid_until: "2026-09-30T23:00:00Z",
        evidence_refs: ref("src-cheap"),
        contact: { company: "Supplier Cheap", channel: "official_sales", value: "sales@example.test" },
      },
      {
        id: "src-better",
        name: "Supplier Better",
        country: "Ghana",
        unit_price: 3050,
        currency: "EUR",
        min_quantity: 1,
        max_quantity: 50,
        evidence_status: "verified_quote",
        evidence_score: 90,
        compliance_status: "clear",
        counterparty_quality_score: 91,
        quote_valid_until: "2026-09-30T23:00:00Z",
        evidence_refs: ref("src-better"),
        contact: { company: "Supplier Better", channel: "official_sales", value: "sales2@example.test" },
      },
    ],
    sale_offers: [
      {
        id: "buyer-de",
        name: "Buyer DE",
        country: "Germany",
        unit_price: 3900,
        currency: "EUR",
        min_quantity: 5,
        max_quantity: 100,
        evidence_status: "verified_quote",
        evidence_score: 88,
        compliance_status: "clear",
        counterparty_quality_score: 90,
        quote_valid_until: "2026-09-30T23:00:00Z",
        evidence_refs: ref("buyer-de"),
        contact: { company: "Buyer DE", channel: "official_procurement", value: "buy@example.test" },
      },
    ],
    routes: [
      {
        id: "route-cheap",
        name: "Tema-Hamburg standard",
        origin_country: "Ghana",
        destination_country: "Germany",
        transit_days: 20,
        evidence_status: "verified_quote",
        evidence_score: 86,
        compliance_status: "clear",
        capacity_score: 80,
        quote_valid_until: "2026-09-30T23:00:00Z",
        evidence_refs: ref("route-cheap"),
        stops: ["Kumasi", "Tema", "Hamburg"],
        costs: [
          { type: "freight", amount: 400, basis: "per_unit", currency: "EUR", evidence_refs: ref("freight-cheap") },
          { type: "insurance", amount: 600, basis: "fixed", currency: "EUR", evidence_refs: ref("insurance-cheap") },
        ],
      },
      {
        id: "route-expensive",
        name: "Tema-Hamburg premium",
        origin_country: "Ghana",
        destination_country: "Germany",
        transit_days: 15,
        evidence_status: "verified_quote",
        evidence_score: 92,
        compliance_status: "clear",
        capacity_score: 92,
        quote_valid_until: "2026-09-30T23:00:00Z",
        evidence_refs: ref("route-expensive"),
        stops: ["Kumasi", "Tema", "Hamburg"],
        costs: [
          { type: "freight", amount: 650, basis: "per_unit", currency: "EUR", evidence_refs: ref("freight-premium") },
          { type: "insurance", amount: 900, basis: "fixed", currency: "EUR", evidence_refs: ref("insurance-premium") },
        ],
      },
    ],
    structures: [
      {
        transaction_type: "physical_trade",
        capital_model: "full_landed_cost",
        compliance_status: "clear",
        evidence_score: 90,
        evidence_refs: ref("structure"),
        costs: [
          { type: "inspection", amount: 700, basis: "fixed", currency: "EUR", evidence_refs: ref("inspection") },
        ],
        settlement: { buyer_terms: "7d", supplier_terms: "prepaid" },
      },
    ],
    scenario: {
      calibration_status: "validated_input",
      probability_of_completion: 88,
      downside_loss: 2500,
      upside_profit: 8000,
      cycle_days: 35,
      evidence_score: 82,
      evidence_refs: ref("scenario"),
    },
  };
}

test("builds every feasible supplied supplier-route-buyer path", () => {
  const result = buildTransactionPaths(baseInput());
  assert.equal(result.candidates.length, 4);
  assert.equal(result.rejected_paths.length, 0);
  assert.equal(result.candidates[0].economics_status, "verified_quotes");
  assert.equal(result.candidates[0].compliance_status, "clear");
  assert.ok(result.candidates[0].contacts.length >= 2);
});

test("computes complete landed economics from quote-backed components", () => {
  const result = buildTransactionPaths(baseInput());
  const candidate = result.candidates.find((item) => item.id.includes("src-cheap") && item.id.includes("route-cheap"));
  assert.equal(candidate.expected_revenue, 39000);
  assert.equal(candidate.expected_cost, 35300);
  assert.equal(candidate.capital_required, 35300);
  assert.equal(candidate.cost_breakdown.reduce((sum, item) => sum + item.amount, 0), 35300);
});

test("cheapest supplier alone does not define best transaction economics", () => {
  const input = baseInput();
  input.source_offers[0].country = "Ghana";
  input.source_offers[1].country = "Cote d'Ivoire";
  input.routes.push({
    id: "route-ci",
    name: "Abidjan-Hamburg",
    origin_country: "Cote d'Ivoire",
    destination_country: "Germany",
    transit_days: 16,
    evidence_status: "verified_quote",
    evidence_score: 90,
    compliance_status: "clear",
    capacity_score: 90,
    quote_valid_until: "2026-09-30T23:00:00Z",
    evidence_refs: ref("route-ci"),
    stops: ["Abidjan", "Hamburg"],
    costs: [
      { type: "freight", amount: 250, basis: "per_unit", currency: "EUR", evidence_refs: ref("freight-ci") },
      { type: "insurance", amount: 500, basis: "fixed", currency: "EUR", evidence_refs: ref("insurance-ci") },
    ],
  });
  const result = buildTransactionPaths(input);
  const gh = result.candidates.find((item) => item.id.includes("src-cheap") && item.id.includes("route-cheap"));
  const ci = result.candidates.find((item) => item.id.includes("src-better") && item.id.includes("route-ci"));
  assert.ok(ci.expected_cost < gh.expected_cost, "higher unit-price supplier can still have lower landed cost");
});

test("rejects expired or provenance-free quotes", () => {
  const input = baseInput();
  input.source_offers[0].quote_valid_until = "2026-09-26T23:00:00Z";
  input.source_offers[1].evidence_refs = [];
  const result = buildTransactionPaths(input);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.rejected_paths.some((item) => item.reasons.includes("source_offer_not_verified_or_expired")));
});

test("rejects cross-currency paths until verified FX is supplied", () => {
  const input = baseInput();
  input.sale_offers[0].currency = "USD";
  input.comparison_currency = "EUR";
  const result = buildTransactionPaths(input);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.rejected_paths.every((item) => item.reasons.includes("buyer_fx_missing_or_unverified")));
});

test("accepts cross-currency paths with attributable current FX evidence", () => {
  const input = baseInput();
  input.sale_offers[0].currency = "USD";
  input.sale_offers[0].unit_price = 4680;
  input.comparison_currency = "EUR";
  input.fx_rates = [{
    id: "fx-eur-usd",
    base_currency: "EUR",
    quote_currency: "USD",
    rate: 1.2,
    observed_at: "2026-09-27T05:00:00Z",
    valid_until: "2026-09-27T12:00:00Z",
    evidence_status: "verified_market",
    provider: "verified-provider",
    evidence_refs: ref("fx-eur-usd"),
  }];
  const result = buildTransactionPaths(input);
  assert.equal(result.candidates.length, 4);
  const candidate = result.candidates[0];
  assert.equal(candidate.currency, "EUR");
  assert.equal(candidate.expected_revenue, 39000);
  assert.ok(candidate.fx_conversions.some((fx) => fx.from_currency === "USD" && fx.to_currency === "EUR"));
  assert.ok(candidate.evidence_manifest.fx.length > 0);
});

test("converts route costs into the requested comparison currency", () => {
  const input = baseInput();
  input.comparison_currency = "EUR";
  input.routes[0].costs[0].currency = "USD";
  input.routes[0].costs[0].amount = 480;
  input.fx_rates = [{
    id: "fx-eur-usd",
    base_currency: "EUR",
    quote_currency: "USD",
    rate: 1.2,
    observed_at: "2026-09-27T05:00:00Z",
    valid_until: "2026-09-27T12:00:00Z",
    evidence_status: "official_reference",
    provider: "official-provider",
    evidence_refs: ref("fx-eur-usd"),
  }];
  const result = buildTransactionPaths(input);
  const candidate = result.candidates.find((item) => item.id.includes("route-cheap"));
  assert.equal(candidate.expected_cost, 35300);
  const freight = candidate.cost_breakdown.find((item) => item.type === "freight");
  assert.equal(freight.original_currency, "USD");
  assert.equal(freight.currency, "EUR");
  assert.equal(freight.amount, 4000);
});

test("blocked compliance survives into the candidate for the ranking engine to reject", () => {
  const input = baseInput();
  input.sale_offers[0].compliance_status = "blocked";
  const result = buildTransactionPaths(input);
  assert.equal(result.candidates.length, 4);
  assert.ok(result.candidates.every((item) => item.compliance_status === "blocked"));
});

test("invalid scenario calibration prevents rankable candidate generation", () => {
  const input = baseInput();
  input.scenario.calibration_status = "unvalidated";
  const result = buildTransactionPaths(input);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.build_warnings.some((warning) => /Scenario inputs are not validated/.test(warning)));
});

test("scope notice forbids claiming global optimality from partial inputs", () => {
  const result = buildTransactionPaths(baseInput());
  assert.match(result.scope_notice, /supplied inputs/i);
  assert.match(result.candidates[0].candidate_scope_notice, /supplied source offers/i);
});


test("strategic alternatives stay scoped to their declared supplier buyer route or transaction type", () => {
  const input = baseInput();
  input.indirect_strategies = [{
    id: "cheap-supplier-brokerage",
    title: "Broker only Supplier Cheap",
    source_id: "src-cheap",
    expected_value: 2000,
    capital_required: 500,
    cycle_days: 10,
    evidence_score: 85,
    downside_loss: 100,
    currency: "EUR",
    evidence_refs: ref("brokerage-cheap"),
  }];
  input.information_actions = [{
    id: "premium-route-inspection",
    title: "Inspect premium route capacity",
    route_id: "route-expensive",
    information_cost: 100,
    expected_decision_loss_reduction: 700,
    capital_required: 100,
    cycle_days: 2,
    evidence_score: 90,
    downside_loss: 100,
    currency: "EUR",
    evidence_refs: ref("route-info"),
  }];

  const result = buildTransactionPaths(input);
  const cheapSupplier = result.candidates.filter((item) => item.id.includes("src-cheap"));
  const betterSupplier = result.candidates.filter((item) => item.id.includes("src-better"));
  const cheapRoute = result.candidates.filter((item) => item.id.includes("route-cheap"));
  const premiumRoute = result.candidates.filter((item) => item.id.includes("route-expensive"));

  assert.ok(cheapSupplier.every((item) =>
    item.indirect_strategies.some((strategy) => strategy.id === "cheap-supplier-brokerage")
  ));
  assert.ok(betterSupplier.every((item) =>
    !item.indirect_strategies.some((strategy) => strategy.id === "cheap-supplier-brokerage")
  ));
  assert.ok(cheapRoute.every((item) =>
    !item.information_actions.some((action) => action.id === "premium-route-inspection")
  ));
  assert.ok(premiumRoute.every((item) =>
    item.information_actions.some((action) => action.id === "premium-route-inspection")
  ));
});

test("unscoped strategic alternative intentionally applies across the supplied candidate set", () => {
  const input = baseInput();
  input.position_options = [{
    id: "global-position-option",
    title: "Product-wide position option",
    commitment_cost: 300,
    option_value_estimate: 1000,
    capital_required: 300,
    cycle_days: 5,
    evidence_score: 80,
    downside_loss: 300,
    currency: "EUR",
    evidence_refs: ref("position-global"),
  }];

  const result = buildTransactionPaths(input);
  assert.equal(result.candidates.length, 4);
  assert.ok(result.candidates.every((item) =>
    item.position_options.some((option) => option.id === "global-position-option")
  ));
});
