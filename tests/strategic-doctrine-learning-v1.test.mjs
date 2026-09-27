
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDoctrineOutcomes } from "../supabase/functions/_shared/strategic-doctrine-learning-v1.mjs";

function row(i, extra = {}) {
  return {
    decision_id: "00000000-0000-4000-8000-" + String(i).padStart(12, "0"),
    doctrine_ids: ["indirect_approach"],
    domain: "trade",
    outcome_verified: true,
    outcome_success: true,
    realized_net_value: 3000,
    baseline_net_value: 2000,
    ...extra,
  };
}

test("small samples remain explicitly insufficient", () => {
  const result = evaluateDoctrineOutcomes([row(1), row(2), row(3)]);
  assert.equal(result.doctrines.length, 1);
  assert.equal(result.doctrines[0].evidence_state, "insufficient_observations");
  assert.equal(result.doctrines[0].causal_attribution_allowed, false);
  assert.equal(result.doctrines[0].promotion_eligible, false);
});

test("larger positive sample is only an observed association, never automatic causality", () => {
  const outcomes = Array.from({ length: 20 }, (_, index) => row(index + 1, {
    realized_net_value: 3000 + index * 10,
    baseline_net_value: 2000,
    outcome_success: index < 16,
  }));
  const result = evaluateDoctrineOutcomes(outcomes);
  const doctrine = result.doctrines[0];

  assert.equal(doctrine.evidence_state, "positive_observed_association");
  assert.equal(doctrine.verified_observation_count, 20);
  assert.equal(doctrine.success_rate, 0.8);
  assert.ok(doctrine.success_rate_wilson_95.lower < doctrine.success_rate);
  assert.ok(doctrine.success_rate_wilson_95.upper > doctrine.success_rate);
  assert.equal(doctrine.causal_attribution_allowed, false);
  assert.equal(result.automatic_doctrine_promotion_allowed, false);
});

test("negative incremental value is surfaced instead of hidden", () => {
  const outcomes = Array.from({ length: 12 }, (_, index) => row(index + 1, {
    realized_net_value: 1000,
    baseline_net_value: 2000,
    outcome_success: index < 4,
  }));
  const result = evaluateDoctrineOutcomes(outcomes);
  const doctrine = result.doctrines[0];

  assert.equal(doctrine.evidence_state, "negative_observed_association");
  assert.equal(doctrine.average_incremental_value_vs_supplied_baseline, -1000);
});

test("low-evidence manual outcomes are excluded from learning", () => {
  const result = evaluateDoctrineOutcomes([
    {
      decision_id: "00000000-0000-4000-8000-000000000001",
      doctrine_ids: ["foreknowledge"],
      domain: "trade",
      outcome_verified: false,
      evidence_quality_score: 30,
      outcome_success: true,
      realized_net_value: 10000,
      baseline_net_value: 0,
    },
  ]);
  assert.equal(result.usable_outcome_count, 0);
  assert.deepEqual(result.doctrines, []);
});

test("high-quality evidence can be used even when outcome_verified flag is absent", () => {
  const result = evaluateDoctrineOutcomes([
    {
      decision_id: "00000000-0000-4000-8000-000000000002",
      doctrine_ids: ["foreknowledge"],
      domain: "trade",
      evidence_quality_score: 90,
      outcome_success: true,
      realized_net_value: 5000,
      baseline_net_value: 2000,
    },
  ]);
  assert.equal(result.usable_outcome_count, 1);
  assert.equal(result.doctrines[0].doctrine_id, "foreknowledge");
});

test("multiple doctrines on one decision are evaluated separately without claiming attribution", () => {
  const result = evaluateDoctrineOutcomes([
    {
      ...row(1),
      doctrine_ids: ["foreknowledge", "economy_of_force"],
    },
  ]);
  assert.deepEqual(result.doctrines.map((item) => item.doctrine_id).sort(), ["economy_of_force", "foreknowledge"]);
  assert.equal(result.causal_claim_allowed, false);
});
