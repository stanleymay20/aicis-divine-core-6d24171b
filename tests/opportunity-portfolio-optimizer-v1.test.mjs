import test from "node:test";
import assert from "node:assert/strict";
import { optimizeOpportunityPortfolio } from "../supabase/functions/_shared/opportunity-portfolio-optimizer-v1.mjs";

function candidate(id, capital, expectedValue, baseProfit, countries = ["ghana"], sectors = ["agriculture"]) {
  return {
    eligible: true,
    candidate_id: id,
    title: id,
    score: 80,
    capital_required: capital,
    currency: "EUR",
    countries,
    sectors,
    execution_ready: true,
    metrics: {
      expected_value: expectedValue,
      base_profit: baseProfit,
      expected_return_on_capital_pct: (expectedValue / capital) * 100,
    },
  };
}

const prefs = {
  alert_preferences: {
    opportunity_profile: {
      capital_available: 100000,
      reserve_pct: 10,
      max_country_capital_pct: 100,
      max_sector_capital_pct: 100,
      max_positions: 8,
    },
  },
};

test("exact optimizer can prefer two smaller transactions over one larger transaction", () => {
  const ranking = {
    ranked: [
      candidate("large", 60000, 12000, 15000),
      candidate("small-a", 45000, 10000, 12000),
      candidate("small-b", 45000, 10000, 12000),
    ],
  };
  const result = optimizeOpportunityPortfolio(ranking, prefs);
  assert.equal(result.optimization_method, "exact_subset_search");
  assert.equal(result.optimality_proven, true);
  assert.deepEqual(result.selected.map((item) => item.candidate_id).sort(), ["small-a", "small-b"]);
  assert.equal(result.capital_deployed, 90000);
  assert.equal(result.expected_value, 20000);
});

test("reserve capital is preserved instead of force-deployed", () => {
  const ranking = { ranked: [candidate("one", 90000, 15000, 18000)] };
  const result = optimizeOpportunityPortfolio(ranking, prefs);
  assert.equal(result.reserve_capital, 10000);
  assert.equal(result.deployable_capital, 90000);
  assert.equal(result.capital_deployed, 90000);
  assert.equal(result.total_cash_remaining, 10000);
});

test("country concentration can block otherwise profitable combinations", () => {
  const constrained = {
    alert_preferences: {
      opportunity_profile: {
        capital_available: 100000,
        reserve_pct: 0,
        max_country_capital_pct: 50,
        max_sector_capital_pct: 100,
        max_positions: 8,
      },
    },
  };
  const ranking = {
    ranked: [
      candidate("gh-a", 45000, 10000, 12000, ["ghana"]),
      candidate("gh-b", 45000, 9000, 11000, ["ghana"]),
      candidate("de", 45000, 8000, 10000, ["germany"]),
    ],
  };
  const result = optimizeOpportunityPortfolio(ranking, constrained);
  assert.equal(result.selected.length, 2);
  assert.ok(result.selected.some((item) => item.candidate_id === "de"));
  assert.equal(result.selected.filter((item) => item.countries.includes("ghana")).length, 1);
});

test("mixed currencies fail closed until verified FX allocation is implemented", () => {
  const eur = candidate("eur", 20000, 4000, 5000);
  const usd = { ...candidate("usd", 20000, 5000, 6000), currency: "USD" };
  const result = optimizeOpportunityPortfolio({ ranked: [eur, usd] }, prefs);
  assert.equal(result.allocation_available, false);
  assert.equal(result.reason, "mixed_currency_portfolio_requires_verified_fx_layer");
});

test("missing capital configuration produces no allocation instead of invented budget", () => {
  const result = optimizeOpportunityPortfolio({ ranked: [candidate("one", 10000, 2000, 2500)] }, {});
  assert.equal(result.allocation_available, false);
  assert.equal(result.reason, "capital_available_not_configured");
});

test("negative expected value candidates are never allocated", () => {
  const bad = candidate("bad", 10000, -500, 1000);
  const result = optimizeOpportunityPortfolio({ ranked: [bad] }, prefs);
  assert.equal(result.selected.length, 0);
  assert.equal(result.no_allocation_reason, "no_positive_expected_value_candidate_fits_capital_and_constraints");
});

test("allocation remains advisory and scoped to supplied candidates", () => {
  const result = optimizeOpportunityPortfolio({ ranked: [candidate("one", 10000, 2000, 2500)] }, prefs);
  assert.equal(result.human_approval_required, true);
  assert.equal(result.external_execution_performed, false);
  assert.match(result.optimization_scope_notice, /supplied/i);
});
