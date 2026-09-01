import test from "node:test";
import assert from "node:assert/strict";

import {
  WORLD_MODEL_CONTRACT_VERSION,
  buildAdmittedTrainingExample,
  evaluateTrainingCandidate,
} from "../scripts/world-model-training-contract.mjs";

const PROOF_SHA = "a".repeat(64);

function validStateTransition(overrides = {}) {
  return {
    example_kind: "state_transition",
    observation_id: "training-row-1",
    label_id: "training-row-1:horizon-label",
    observed_at: "2026-08-01T00:00:00.000Z",
    historical_cutoff_at: "2026-08-01T23:59:59.000Z",
    label_horizon_end_at: "2026-08-08T23:59:59.000Z",
    label_observed_at: "2026-08-09T01:00:00.000Z",
    label_value: 1,
    realized_outcome: "deteriorated",
    realized_impact: 0.72,
    label_source: "observed_future_metric",
    evidence_status: "validated",
    knowledge_time_status: "verified_leakage_safe",
    knowledge_time_proof_version: "knowledge-time-v3",
    knowledge_time_proof_sha256: PROOF_SHA,
    knowledge_time_verification_method: "immutable_lineage_verifier_v1",
    source_record_ids: ["metric-1", "metric-2", "event-1"],
    source_names: ["normalized_metrics", "normalized_events"],
    domain: "economy",
    regions: ["DEU"],
    raw_features: { metric_sample_count_30d: 18 },
    derived_features: { metric_zscore_vs_90d: 1.3 },
    is_synthetic: false,
    is_backfilled_without_provenance: false,
    ...overrides,
  };
}

function validForecastOutcome(overrides = {}) {
  return {
    ...validStateTransition(),
    example_kind: "forecast_outcome",
    observation_id: "signal-1",
    label_id: "truth-1",
    forecast_id: "forecast-1",
    forecast_created_at: "2026-08-02T00:00:00.000Z",
    forecast_horizon_hours: 168,
    forecast_probability: 0.64,
    label_source: "forecast_ground_truth",
    source_record_ids: ["signal-1", "forecast-1", "truth-1"],
    source_names: ["global_signals", "predictive_forecasts", "forecast_ground_truth"],
    ...overrides,
  };
}

test("admits a leakage-safe state-transition example", () => {
  const result = evaluateTrainingCandidate(validStateTransition());
  assert.deepEqual(result, { admissible: true, reasons: [] });
});

test("admits a temporally valid forecast-outcome example", () => {
  const result = evaluateTrainingCandidate(validForecastOutcome());
  assert.deepEqual(result, { admissible: true, reasons: [] });
});

test("builds an immutable versioned training example", () => {
  const example = buildAdmittedTrainingExample(validStateTransition());
  assert.equal(example.contract_version, WORLD_MODEL_CONTRACT_VERSION);
  assert.equal(example.example_kind, "state_transition");
  assert.equal(example.ground_truth.realized_outcome, "deteriorated");
  assert.equal(example.provenance.knowledge_time_status, "verified_leakage_safe");
  assert.equal(Object.isFrozen(example), true);
  assert.equal(Object.isFrozen(example.observation), true);
  assert.equal(Object.isFrozen(example.ground_truth), true);
});

test("rejects a derived model score used as ground truth", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ label_source: "derived_score" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("label_source_not_ground_truth"));
});

test("rejects legacy or otherwise unverified evidence", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ evidence_status: "legacy_unknown" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("evidence_not_verified"));
});

test("rejects rows without verified historical knowledge-time proof", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ knowledge_time_status: "unverified" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("knowledge_time_not_verified_leakage_safe"));
});

test("rejects malformed knowledge-time proof digests", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ knowledge_time_proof_sha256: "not-a-proof" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("knowledge_time_proof_sha256_invalid"));
});

test("rejects synthetic training candidates", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ is_synthetic: true }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("synthetic_candidate_forbidden"));
});

test("rejects labels observed before the forecast horizon closes", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ label_observed_at: "2026-08-07T00:00:00.000Z" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("label_observed_before_horizon_end"));
});

test("rejects candidates without record-level provenance", () => {
  const result = evaluateTrainingCandidate(
    validStateTransition({ source_record_ids: [] }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("source_record_ids_missing"));
});

test("rejects forecast probabilities outside the unit interval", () => {
  const result = evaluateTrainingCandidate(
    validForecastOutcome({ forecast_probability: 64 }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("forecast_probability_out_of_unit_interval"));
});

test("throws rather than manufacturing a record with no ground-truth label", () => {
  assert.throws(
    () => buildAdmittedTrainingExample(validStateTransition({ label_value: null, realized_outcome: null })),
    (error) => {
      assert.equal(error.code, "AICIS_WORLD_MODEL_CANDIDATE_REJECTED");
      assert.ok(error.reasons.includes("ground_truth_label_missing"));
      return true;
    },
  );
});
