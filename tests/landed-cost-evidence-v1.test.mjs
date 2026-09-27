
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLandedCostEvidence } from "../supabase/functions/_shared/landed-cost-evidence-v1.mjs";

const HASH = "c".repeat(64);
const ref = (id) => [{ source_id: id, observed_at: "2026-09-27T16:00:00Z", sha256: HASH }];

function coverage(overrides = {}) {
  const statuses = {
    export_customs: { status: "not_applicable", reason: "No separate export customs charge for supplied scenario", evidence_refs: ref("export-na") },
    import_duty: { status: "included_here" },
    import_tax: { status: "included_here" },
    customs_brokerage: { status: "included_here" },
    inspection_certification: { status: "covered_elsewhere", existing_cost_id: "inspection-route", evidence_refs: ref("inspection-existing") },
    cargo_insurance: { status: "covered_elsewhere", existing_cost_id: "insurance-route", evidence_refs: ref("insurance-existing") },
    financing: { status: "included_here" },
    destination_handling: { status: "included_here" },
    ...overrides,
  };
  return Object.entries(statuses).map(([category, value]) => ({ category, ...value }));
}

function components() {
  return [
    {
      id: "duty",
      category: "import_duty",
      label: "Import duty",
      calculation_kind: "percent_of_basis",
      rate_pct: 5,
      basis: { name: "declared_customs_value", amount: 30000, currency: "EUR", evidence_refs: ref("customs-value") },
      cash_flow_treatment: "cost",
      evidence_status: "official_rule",
      source_kind: "official_customs_tariff",
      effective_from: "2026-01-01T00:00:00Z",
      evidence_refs: ref("duty-rule"),
    },
    {
      id: "vat",
      category: "import_tax",
      label: "Import VAT",
      calculation_kind: "percent_of_basis",
      rate_pct: 19,
      basis: { name: "declared_tax_basis", amount: 31500, currency: "EUR", evidence_refs: ref("tax-basis") },
      cash_flow_treatment: "recoverable_tax",
      evidence_status: "official_rule",
      source_kind: "official_tax_rule",
      effective_from: "2026-01-01T00:00:00Z",
      evidence_refs: ref("vat-rule"),
    },
    {
      id: "broker",
      category: "customs_brokerage",
      calculation_kind: "fixed",
      amount: 300,
      currency: "EUR",
      cash_flow_treatment: "cost",
      evidence_status: "verified_quote",
      source_kind: "customs_broker_quote",
      valid_until: "2026-10-05T00:00:00Z",
      evidence_refs: ref("broker-quote"),
    },
    {
      id: "finance",
      category: "financing",
      calculation_kind: "percent_of_basis",
      rate_pct: 1,
      basis: { name: "financed_amount_for_period", amount: 20000, currency: "EUR", evidence_refs: ref("finance-basis") },
      cash_flow_treatment: "cost",
      evidence_status: "verified_quote",
      source_kind: "financing_quote",
      valid_until: "2026-10-05T00:00:00Z",
      evidence_refs: ref("finance-quote"),
    },
    {
      id: "terminal",
      category: "destination_handling",
      calculation_kind: "per_unit",
      amount: 25,
      currency: "EUR",
      cash_flow_treatment: "cost",
      evidence_status: "verified_quote",
      source_kind: "provider_quote",
      valid_until: "2026-10-05T00:00:00Z",
      evidence_refs: ref("terminal-quote"),
    },
  ];
}

function baseInput() {
  return {
    as_of: "2026-09-27T17:00:00Z",
    candidate_id: "tx:cocoa",
    product_id: "cocoa",
    hs_code: "180100",
    origin_country: "GHA",
    destination_country: "DEU",
    quantity: 10,
    quantity_unit: "tonnes",
    comparison_currency: "EUR",
    coverage: coverage(),
    components: components(),
    fx_rates: [],
  };
}

test("complete attributable stack separates true cost from recoverable tax cash flow", () => {
  const result = evaluateLandedCostEvidence(baseInput());

  assert.equal(result.coverage_complete, true);
  assert.equal(result.execution_ready_cost_stack, true);
  assert.equal(result.supplemental_landed_cost, 2250);
  assert.equal(result.recoverable_tax_cash_flow, 5985);
  assert.equal(result.supplemental_cash_requirement, 8235);
  assert.equal(result.normalized_structure_costs.length, 4);
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.execution_boundary.payment_made, false);
});

test("missing required category fails closed", () => {
  const input = baseInput();
  input.coverage = input.coverage.filter((item) => item.category !== "financing");
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, false);
  assert.ok(result.missing_categories.includes("financing"));
  assert.ok(result.missing_execution_fields.includes("complete_landed_cost_coverage"));
});

test("not-applicable declaration requires attributable evidence", () => {
  const input = baseInput();
  input.coverage = coverage({
    export_customs: { status: "not_applicable", reason: "No charge", evidence_refs: [] },
  });
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, false);
  assert.ok(result.invalid_coverage.some((item) =>
    item.category === "export_customs" && item.reason === "not_applicable_evidence_invalid"
  ));
});

test("covered-elsewhere category requires cost identity and evidence", () => {
  const input = baseInput();
  input.coverage = coverage({
    cargo_insurance: { status: "covered_elsewhere", evidence_refs: [] },
  });
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, false);
  assert.ok(result.invalid_coverage.some((item) => item.category === "cargo_insurance"));
});

test("observed-market cost may support research completeness but never execution readiness", () => {
  const input = baseInput();
  input.components[2].evidence_status = "observed_market";
  input.components[2].source_kind = "other_verified_source";
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, true);
  assert.equal(result.research_complete, true);
  assert.equal(result.execution_ready_cost_stack, false);
  assert.ok(result.missing_execution_fields.includes("execution_grade_cost_evidence"));
});

test("official-reference FX permits research normalization but blocks execution-ready cost stack", () => {
  const input = baseInput();
  input.components[2].currency = "USD";
  input.components[2].amount = 360;
  input.fx_rates = [{
    id: "eur-usd",
    base_currency: "EUR",
    quote_currency: "USD",
    rate: 1.2,
    observed_at: "2026-09-27T16:00:00Z",
    valid_until: "2026-09-27T20:00:00Z",
    evidence_status: "official_reference",
    provider: "official-provider",
    evidence_refs: ref("fx-reference"),
  }];
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, true);
  assert.equal(result.execution_ready_cost_stack, false);
  assert.ok(result.missing_execution_fields.includes("executable_fx_for_landed_costs"));
});

test("executable FX allows execution-ready normalized cost evidence", () => {
  const input = baseInput();
  input.components[2].currency = "USD";
  input.components[2].amount = 360;
  input.fx_rates = [{
    id: "eur-usd-live",
    base_currency: "EUR",
    quote_currency: "USD",
    rate: 1.2,
    observed_at: "2026-09-27T16:00:00Z",
    valid_until: "2026-09-27T20:00:00Z",
    evidence_status: "executable_quote",
    provider: "provider",
    evidence_refs: ref("fx-live"),
  }];
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, true);
  assert.equal(result.execution_ready_cost_stack, true);
  const brokerage = result.components.find((item) => item.id === "broker");
  assert.equal(brokerage.amount, 300);
  assert.equal(brokerage.fx_conversion.execution_eligible_fx, true);
});

test("percentage cost requires attributable basis evidence", () => {
  const input = baseInput();
  input.components[0].basis.evidence_refs = [];
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, false);
  assert.ok(result.invalid_components.some((item) =>
    item.component_id === "duty" && item.reasons.includes("basis_evidence_invalid")
  ));
});

test("customs and tax components require a usable HS classification", () => {
  const input = baseInput();
  input.hs_code = "1801";
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, false);
  assert.ok(result.invalid_components.some((item) =>
    item.reasons.includes("hs_code_required_for_customs_or_tax")
  ));
});

test("stale commercial quote fails closed", () => {
  const input = baseInput();
  input.components[2].valid_until = "2026-09-26T00:00:00Z";
  const result = evaluateLandedCostEvidence(input);

  assert.equal(result.coverage_complete, false);
  assert.ok(result.invalid_components.some((item) =>
    item.component_id === "broker" && item.reasons.includes("component_evidence_stale_or_not_yet_effective")
  ));
});
