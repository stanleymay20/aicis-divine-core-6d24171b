import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOpportunity, rankOpportunities } from "../supabase/functions/_shared/opportunity-engine-v1.mjs";

const prefs = {
  countries: ["ghana", "germany"],
  industries: ["agriculture", "logistics"],
  domains: ["supply_chain"],
  watched_entities: ["tema"],
  keywords: ["cocoa"],
  risk_priorities: ["price shock"],
  alert_preferences: {
    opportunity_profile: {
      objective: "balanced",
      risk_tolerance: "balanced",
      capital_available: 100000,
      max_cycle_days: 60,
      min_base_margin_pct: 3,
      min_evidence_score: 60,
      min_relevance_score: 45,
      minimum_rank_score: 55,
      max_single_opportunity_capital_pct: 60,
      allowed_transaction_types: ["physical_trade", "brokerage"],
    },
  },
};

const good = {
  id: "opp-1",
  title: "Cocoa physical trade via Tema",
  summary: "Verified cocoa sourcing and buyer quote",
  transaction_type: "physical_trade",
  domain: "supply_chain",
  sectors: ["agriculture", "logistics"],
  countries: ["ghana", "germany"],
  entities: ["Tema"],
  capital_required: 50000,
  expected_revenue: 62000,
  expected_cost: 56000,
  downside_loss: 3500,
  cycle_days: 35,
  probability_of_completion: 82,
  evidence_score: 86,
  counterparty_quality_score: 80,
  liquidity_score: 70,
  compliance_status: "clear",
  economics_status: "verified_quotes",
  market_freshness_minutes: 120,
  source_offer: { name: "Verified Supplier Ltd", country: "Ghana", quote_ref: "Q-SRC-1" },
  sale_offer: { name: "Verified Buyer GmbH", country: "Germany", quote_ref: "Q-BUY-1" },
  counterparties: [
    { role: "supplier", name: "Verified Supplier Ltd" },
    { role: "buyer", name: "Verified Buyer GmbH" },
  ],
  route: ["Kumasi", "Tema", "Hamburg"],
  cost_breakdown: [
    { type: "goods", amount: 50000 },
    { type: "freight", amount: 3000 },
    { type: "insurance", amount: 1000 },
    { type: "other", amount: 2000 },
  ],
  contacts: [
    { company: "Verified Supplier Ltd", channel: "official_sales" },
    { company: "Verified Buyer GmbH", channel: "official_procurement" },
  ],
  timing: { quote_valid_until: "2026-10-02T12:00:00Z", expected_cycle_days: 35 },
  next_actions: ["Confirm firm supplier quote", "Confirm buyer purchase indication", "Lock freight"],
};

test("eligible opportunity gets economics and relevance scoring", () => {
  const result = evaluateOpportunity(good, prefs);
  assert.equal(result.eligible, true);
  assert.equal(result.metrics.base_profit, 6000);
  assert.ok(result.components.relevance_score >= 70);
  assert.equal(result.human_approval_required, true);
  assert.equal(result.execution_ready, true);
  assert.equal(result.execution_dossier.who.counterparties.length, 2);
});

test("unverified economics fail closed", () => {
  const result = evaluateOpportunity({ ...good, id: "opp-2", economics_status: "synthetic" }, prefs);
  assert.equal(result.eligible, false);
  assert.ok(result.rejection_reasons.includes("economics_not_verified"));
});

test("capital concentration limit is enforced", () => {
  const result = evaluateOpportunity({ ...good, id: "opp-3", capital_required: 90000 }, prefs);
  assert.equal(result.eligible, false);
  assert.ok(result.rejection_reasons.includes("single_opportunity_capital_limit_exceeded"));
});

test("relevance can reject otherwise profitable opportunities", () => {
  const result = evaluateOpportunity({
    ...good,
    id: "opp-4",
    title: "Semiconductor trade in Japan",
    summary: "Chip equipment opportunity",
    domain: "technology",
    sectors: ["semiconductors"],
    countries: ["japan"],
    entities: ["Tokyo"],
  }, prefs);
  assert.equal(result.eligible, false);
  assert.ok(result.rejection_reasons.includes("relevance_below_threshold"));
});

test("ranking may correctly recommend no transaction", () => {
  const result = rankOpportunities([{ ...good, id: "opp-5", evidence_score: 40 }], prefs);
  assert.equal(result.no_transaction_recommended, true);
  assert.equal(result.top_ranked, null);
});

test("ranking chooses the strongest supplied eligible candidate, not a claimed global best", () => {
  const stronger = {
    ...good,
    id: "opp-6",
    title: "Cocoa brokerage via Tema",
    transaction_type: "brokerage",
    capital_required: 10000,
    expected_revenue: 15000,
    expected_cost: 11000,
    downside_loss: 800,
    cycle_days: 14,
    probability_of_completion: 88,
  };
  const result = rankOpportunities([good, stronger], prefs);
  assert.equal(result.no_transaction_recommended, false);
  assert.equal(result.top_ranked.candidate_id, "opp-6");
  assert.match(result.ranking_scope_notice, /only among candidates supplied/i);
});


test("rankable economics can remain non-executable when transaction details are incomplete", () => {
  const incomplete = {
    ...good,
    id: "opp-7",
    source_offer: null,
    contacts: [],
  };
  const result = evaluateOpportunity(incomplete, prefs);
  assert.equal(result.eligible, true);
  assert.equal(result.execution_ready, false);
  assert.ok(result.execution_dossier.missing_execution_fields.includes("source_offer"));
  assert.ok(result.execution_dossier.missing_execution_fields.includes("contacts"));
});


test("reference or market FX can rank a path but cannot make it execution-ready", () => {
  const candidate = {
    ...good,
    id: "opp-fx-reference",
    fx_execution_ready: false,
  };
  const result = evaluateOpportunity(candidate, prefs);
  assert.equal(result.eligible, true);
  assert.equal(result.execution_ready, false);
  assert.ok(result.execution_dossier.missing_execution_fields.includes("executable_fx_quote"));
});


test("incomplete landed cost hard-rejects a builder-produced physical trade", () => {
  const result = evaluateOpportunity({
    ...good,
    id: "opp-landed-incomplete",
    landed_cost_complete: false,
    landed_cost_execution_ready: false,
  }, prefs);

  assert.equal(result.eligible, false);
  assert.ok(result.rejection_reasons.includes("landed_cost_incomplete"));
});

test("research-complete landed cost can rank but remains non-executable until execution-grade", () => {
  const result = evaluateOpportunity({
    ...good,
    id: "opp-landed-research",
    landed_cost_complete: true,
    landed_cost_execution_ready: false,
  }, prefs);

  assert.equal(result.eligible, true);
  assert.equal(result.execution_ready, false);
  assert.ok(result.execution_dossier.missing_execution_fields.includes("execution_grade_landed_cost_evidence"));
});

test("recoverable-tax cash-flow adjustments survive into the execution dossier", () => {
  const result = evaluateOpportunity({
    ...good,
    id: "opp-landed-cash",
    landed_cost_complete: true,
    landed_cost_execution_ready: true,
    cash_flow_adjustments: [{
      type: "recoverable_tax_cash_requirement",
      amount: 5985,
      currency: "EUR",
      economic_cost: false,
    }],
    landed_cost_evidence: {
      verification_version: "aicis-landed-cost-evidence-v1",
      coverage_complete: true,
    },
  }, prefs);

  assert.equal(result.eligible, true);
  assert.equal(result.execution_dossier.cash_flow_adjustments[0].amount, 5985);
  assert.equal(result.execution_dossier.landed_cost_evidence.coverage_complete, true);
});

test("user-declared scenario assumptions remain research-only even if profile thresholds are lowered", () => {
  const permissivePrefs = {
    ...prefs,
    alert_preferences: {
      opportunity_profile: {
        ...prefs.alert_preferences.opportunity_profile,
        min_evidence_score: 0,
      },
    },
  };

  const result = evaluateOpportunity({
    ...good,
    id: "opp-user-scenario",
    scenario_research_only: true,
    scenario_evidence_semantics: "user_declared_research_assumption_not_empirically_calibrated",
    landed_cost_complete: true,
    landed_cost_execution_ready: true,
  }, permissivePrefs);

  assert.equal(result.eligible, false);
  assert.ok(result.rejection_reasons.includes("scenario_research_only_user_assumption"));
  assert.equal(result.execution_ready, false);
  assert.ok(result.execution_dossier.missing_execution_fields.includes("independently_validated_scenario"));
});

