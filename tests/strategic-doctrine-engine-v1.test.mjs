
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStrategicState,
  evaluateStrategicOptions,
} from "../supabase/functions/_shared/strategic-doctrine-engine-v1.mjs";

const prefs = {
  alert_preferences: {
    opportunity_profile: {
      capital_available: 20000,
      max_cycle_days: 60,
      risk_tolerance: "balanced",
      objective: "return_on_capital",
      reserve_pct: 10,
    },
  },
};

function directCandidate() {
  return {
    candidate_id: "physical-cocoa",
    title: "Physical cocoa trade",
    transaction_type: "physical_trade",
    score: 88,
    execution_ready: true,
    currency: "EUR",
    capital_required: 48000,
    components: { evidence_score: 91 },
    metrics: {
      expected_value: 7200,
      base_profit: 9000,
    },
    execution_dossier: {
      when: { cycle_days: 45 },
      profitability: { downside: -8000 },
    },
    scenarios: [
      { id: "base", net_value: 7200 },
      { id: "freight_spike", net_value: -5000 },
      { id: "strong_demand", net_value: 12000 },
    ],
    indirect_strategies: [
      {
        id: "broker-cocoa",
        title: "Broker verified supplier to buyer",
        expected_value: 2800,
        base_profit: 3200,
        capital_required: 800,
        cycle_days: 18,
        evidence_score: 84,
        downside_loss: 300,
        reversibility_score: 90,
        execution_friction_score: 25,
        required_capabilities: ["brokerage"],
        executable_input: false,
        invalidation_rules: ["buyer_indication_withdrawn"],
        switching_rules: ["if_direct_financing_secured_then_reassess_principal_trade"],
        scenarios: [
          { id: "base", net_value: 2800 },
          { id: "freight_spike", net_value: 2500 },
          { id: "strong_demand", net_value: 3500 },
        ],
      },
    ],
    information_actions: [
      {
        id: "inspect-supplier",
        title: "Order supplier capacity inspection",
        capital_required: 300,
        cycle_days: 3,
        evidence_score: 95,
        downside_loss: 300,
        reversibility_score: 95,
        execution_friction_score: 10,
        required_capabilities: [],
      },
    ],
  };
}

test("strategic state preserves actor, terrain and timing as separate decision dimensions", () => {
  const state = buildStrategicState({
    actor_state: {
      capabilities: ["brokerage"],
      licenses: ["eu-business-registration"],
      constraints: ["no-warehouse"],
      capital_available: 20000,
    },
    terrain: {
      geographies: ["Ghana", "Germany"],
      regulatory_constraints: ["food-import-controls"],
    },
    timing: {
      preferred_action_by: "2026-10-05T12:00:00Z",
      invalid_after: "2026-10-12T12:00:00Z",
    },
    objective: "return_on_capital",
  });
  assert.deepEqual(state.actor_state.capabilities, ["brokerage"]);
  assert.deepEqual(state.terrain.geographies, ["Ghana", "Germany"]);
  assert.equal(state.timing.invalid_after, "2026-10-12T12:00:00Z");
  assert.equal(state.semantics, "strategic_state_not_prediction");
});

test("capital-heavy direct transaction loses feasibility while supplied brokerage remains selectable", () => {
  const result = evaluateStrategicOptions({
    ranked_candidates: [directCandidate()],
    actor_state: { capabilities: ["brokerage"] },
    preferences: prefs,
  });

  const direct = result.options.find((item) => item.id === "strategy:direct:physical-cocoa");
  const broker = result.options.find((item) => item.id === "broker-cocoa");

  assert.equal(direct.feasible, false);
  assert.ok(direct.feasibility_reasons.includes("capital_required_exceeds_available"));
  assert.equal(broker.feasible, true);
  assert.equal(result.primary_strategy.id, "broker-cocoa");
  assert.equal(result.primary_strategy.strategy_type, "indirect");
});

test("unknown-economics information action remains research-only and cannot become primary strategy", () => {
  const result = evaluateStrategicOptions({
    ranked_candidates: [directCandidate()],
    actor_state: { capabilities: ["brokerage"] },
    preferences: prefs,
  });
  const info = result.options.find((item) => item.id === "inspect-supplier");
  assert.equal(info.research_only, true);
  assert.equal(info.feasible, false);
  assert.ok(info.feasibility_reasons.includes("expected_value_unknown"));
  assert.equal(result.primary_strategy.id, "broker-cocoa");
});

test("no action is always represented as a zero-capital reversible option", () => {
  const result = evaluateStrategicOptions({
    ranked_candidates: [directCandidate()],
    actor_state: { capabilities: ["brokerage"] },
    preferences: prefs,
  });
  const noAction = result.options.find((item) => item.strategy_type === "no_action");
  assert.ok(noAction);
  assert.equal(noAction.capital_required, 0);
  assert.equal(noAction.expected_value, 0);
  assert.equal(noAction.reversibility_score, 100);
  assert.equal(noAction.feasible, true);
});

test("scenario engine computes robustness and comparative regret when options share scenarios", () => {
  const result = evaluateStrategicOptions({
    ranked_candidates: [directCandidate()],
    actor_state: { capabilities: ["brokerage"] },
    preferences: {
      alert_preferences: {
        opportunity_profile: {
          ...prefs.alert_preferences.opportunity_profile,
          capital_available: 100000,
        },
      },
    },
  });
  const direct = result.options.find((item) => item.id === "strategy:direct:physical-cocoa");
  const broker = result.options.find((item) => item.id === "broker-cocoa");
  assert.equal(direct.robustness.scenario_count, 3);
  assert.equal(direct.robustness.worst_case, -5000);
  assert.equal(broker.robustness.worst_case, 2500);
  assert.ok(direct.regret.comparable_scenarios >= 3);
  assert.ok(broker.regret.comparable_scenarios >= 3);
});

test("indirect option records doctrine provenance instead of treating doctrine as authority", () => {
  const result = evaluateStrategicOptions({
    ranked_candidates: [directCandidate()],
    actor_state: { capabilities: ["brokerage"] },
    preferences: prefs,
  });
  const broker = result.options.find((item) => item.id === "broker-cocoa");
  const ids = broker.doctrine_trace.map((item) => item.id);
  assert.ok(ids.includes("indirect_approach"));
  assert.ok(ids.includes("know_self"));
  assert.match(result.scope_notice, /testable heuristics/i);
});

test("missing required capability blocks an otherwise attractive indirect option", () => {
  const result = evaluateStrategicOptions({
    ranked_candidates: [directCandidate()],
    actor_state: { capabilities: [] },
    preferences: prefs,
  });
  const broker = result.options.find((item) => item.id === "broker-cocoa");
  assert.equal(broker.feasible, false);
  assert.deepEqual(broker.missing_capabilities, ["brokerage"]);
});

test("research-only strategic ideas never enter the Pareto selection set", () => {
  const candidate = directCandidate();
  candidate.position_options = [{
    id: "exclusive-distribution",
    title: "Negotiate exclusive representation",
    capital_required: 2000,
    cycle_days: 14,
    evidence_score: 80,
    downside_loss: 500,
    reversibility_score: 70,
    execution_friction_score: 45,
    research_only: true,
  }];
  const result = evaluateStrategicOptions({
    ranked_candidates: [candidate],
    actor_state: { capabilities: ["brokerage"] },
    preferences: prefs,
  });
  const position = result.options.find((item) => item.id === "exclusive-distribution");
  assert.equal(position.research_only, true);
  assert.equal(position.pareto_frontier, false);
});


test("mixed-currency strategic options fail closed instead of comparing nominal values", () => {
  const candidate = directCandidate();
  candidate.indirect_strategies.push({
    id: "usd-broker",
    title: "USD brokerage alternative",
    expected_value: 4000,
    base_profit: 4500,
    capital_required: 1000,
    cycle_days: 15,
    evidence_score: 85,
    downside_loss: 200,
    reversibility_score: 90,
    execution_friction_score: 20,
    required_capabilities: ["brokerage"],
    currency: "USD",
  });
  const result = evaluateStrategicOptions({
    ranked_candidates: [candidate],
    actor_state: { capabilities: ["brokerage"] },
    preferences: {
      alert_preferences: {
        opportunity_profile: {
          ...prefs.alert_preferences.opportunity_profile,
          capital_available: 100000,
        },
      },
    },
  });
  assert.equal(result.primary_strategy, null);
  assert.equal(result.comparison_blocked_reason, "mixed_currency_strategy_options_require_verified_fx_normalization");
});

test("economic option with unknown currency remains infeasible", () => {
  const candidate = directCandidate();
  candidate.currency = null;
  candidate.indirect_strategies = [{
    id: "unknown-currency",
    title: "Unknown currency option",
    expected_value: 2000,
    capital_required: 500,
    cycle_days: 10,
    evidence_score: 80,
    downside_loss: 100,
    required_capabilities: ["brokerage"],
  }];
  const result = evaluateStrategicOptions({
    ranked_candidates: [candidate],
    actor_state: { capabilities: ["brokerage"] },
    preferences: prefs,
  });
  const option = result.options.find((item) => item.id === "unknown-currency");
  assert.equal(option.feasible, false);
  assert.ok(option.feasibility_reasons.includes("currency_unknown"));
});
