import test from "node:test";
import assert from "node:assert/strict";

import {
  WORLD_MODEL_CONTRACT_VERSION,
  buildAdmittedTrainingExample,
  evaluateTrainingCandidate,
} from "../scripts/world-model-training-contract.mjs";

function validCandidate(overrides = {}) {
  return {
    observation_id: "signal-1",
    forecast_id: "forecast-1",
    ground_truth_id: "truth-1",
    observed_at: "2026-08-01T00:00:00.000Z",
    forecast_created_at: "2026-08-01T01:00:00.000Z",
    validated_at: "2026-08-08T02:00:00.000Z",
    realized_outcome: "escalation_observed",
    realized_impact: 0.72,
    label_source: "ground_truth",
    evidence_status: "validated",
    source_record_ids: ["signal-1", "truth-1"],
    source_names: ["global_signals", "forecast_ground_truth"],
    domain: "geopolitics",
    regions: ["DE", "EU"],
    raw_features: { source_count: 3 },
    derived_features: { weak_signal_score: 0.61 },
    forecast_horizon_hours: 168,
    forecast_probability: 0.64,
    is_synthetic: false,
    is_backfilled_without_provenance: false,
    ...overrides,
  };
}

test("admits a temporally valid, verified ground-truth example", () => {
  const result = evaluateTrainingCandidate(validCandidate());
  assert.deepEqual(result, { admissible: true, reasons: [] });
});

test("builds an immutable versioned training example", () => {
  const example = buildAdmittedTrainingExample(validCandidate());
  assert.equal(example.contract_version, WORLD_MODEL_CONTRACT_VERSION);
  assert.equal(example.ground_truth.realized_outcome, "escalation_observed");
  assert.equal(Object.isFrozen(example), true);
  assert.equal(Object.isFrozen(example.observation), true);
  assert.equal(Object.isFrozen(example.ground_truth), true);
});

test("rejects a derived model score used as ground truth", () => {
  const result = evaluateTrainingCandidate(
    validCandidate({ label_source: "derived_score" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("label_source_not_ground_truth"));
});

test("rejects legacy or otherwise unverified evidence", () => {
  const result = evaluateTrainingCandidate(
    validCandidate({ evidence_status: "legacy_unknown" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("evidence_not_verified"));
});

test("rejects synthetic training candidates", () => {
  const result = evaluateTrainingCandidate(
    validCandidate({ is_synthetic: true }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("synthetic_candidate_forbidden"));
});

test("rejects validation that occurs at or before forecast creation", () => {
  const result = evaluateTrainingCandidate(
    validCandidate({ validated_at: "2026-08-01T00:30:00.000Z" }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("validation_not_strictly_after_forecast"));
});

test("rejects candidates without record-level provenance", () => {
  const result = evaluateTrainingCandidate(
    validCandidate({ source_record_ids: [] }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("source_record_ids_missing"));
});

test("rejects probabilities outside the unit interval", () => {
  const result = evaluateTrainingCandidate(
    validCandidate({ forecast_probability: 64 }),
  );
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("forecast_probability_out_of_unit_interval"));
});

test("throws rather than manufacturing a training record from rejected evidence", () => {
  assert.throws(
    () => buildAdmittedTrainingExample(validCandidate({ realized_outcome: null })),
    (error) => {
      assert.equal(error.code, "AICIS_WORLD_MODEL_CANDIDATE_REJECTED");
      assert.ok(error.reasons.includes("realized_outcome_missing"));
      return true;
    },
  );
});
