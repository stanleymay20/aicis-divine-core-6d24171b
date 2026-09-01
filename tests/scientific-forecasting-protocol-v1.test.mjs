import test from "node:test";
import assert from "node:assert/strict";

import {
  SCIENTIFIC_FORECASTING_PROTOCOL_VERSION,
  assertValidForecastTask,
  validateForecastTask,
} from "../scripts/scientific-forecasting-protocol-v1.mjs";

function validBinaryTask(overrides = {}) {
  return {
    protocol_version: SCIENTIFIC_FORECASTING_PROTOCOL_VERSION,
    task_id: "conflict-material-escalation-30d",
    task_version: "1.0.0",
    title: "Material conflict escalation within 30 days",
    domain: "conflict",
    geography_level: "country",
    knowledge_time_policy: "verified_point_in_time_v1",
    target: {
      type: "binary",
      definition: "Whether governed conflict evidence satisfies the registered material-escalation resolution rule during the 30-day target window.",
      outcome_field: "material_escalation_observed",
    },
    horizon: { value: 30, unit: "days" },
    resolution: {
      authority: "registered governed conflict ground-truth source",
      authority_class: "governed_event_dataset",
      outcome_query: "registered conflict escalation resolver v1",
      revision_policy: "versioned_as_of_resolution",
    },
    baseline_suite: ["base_rate", "persistence", "logistic_baseline"],
    metrics: {
      primary: "brier",
      secondary: ["log_loss", "pr_auc", "calibration_error"],
    },
    evaluation: {
      split_policy: "knowledge_time_bounded_rolling_origin",
      minimum_forecast_origins: 6,
      test_data_policy: "future_only_after_model_selection",
      modes: ["retrospective_rolling_origin", "shadow_or_prospective"],
    },
    calibration: {
      required: true,
      method_policy: "fit_on_resolved_calibration_data_only_never_test_or_unresolved_future",
      minimum_resolved_forecasts_for_claim: 200,
    },
    abstention: {
      enabled: true,
      triggers: [
        "knowledge_time_unverified",
        "source_coverage_insufficient",
        "calibration_insufficient",
        "severe_distribution_shift",
        "excessive_model_disagreement",
      ],
    },
    promotion: {
      no_auto_promotion: true,
      requires_positive_skill_vs_mandatory_baselines: true,
      requires_prospective_evidence_for_operational_use: true,
      minimum_resolved_forecasts_for_operational_use: 200,
    },
    ledger: {
      immutable_after_seal: true,
      seal_before_resolution_window_opens: true,
      required_hashes: [
        "data_manifest_hash",
        "feature_manifest_hash",
        "model_artifact_hash",
        "git_commit_sha",
      ],
    },
    claim_semantics: "predictive_not_causal_without_identification",
    ...overrides,
  };
}

test("accepts a protocol-complete binary forecast task", () => {
  assert.deepEqual(validateForecastTask(validBinaryTask()), { valid: true, reasons: [] });
  assert.equal(assertValidForecastTask(validBinaryTask()), true);
});

test("rejects tasks that do not bind to the exact protocol version", () => {
  const result = validateForecastTask(validBinaryTask({ protocol_version: "latest" }));
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("protocol_version_mismatch"));
});

test("rejects random or generic temporal splitting", () => {
  const task = validBinaryTask();
  task.evaluation.split_policy = "random_80_20";
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("evaluation_split_policy_must_be_knowledge_time_bounded_rolling_origin"));
});

test("requires mandatory simple baselines before advanced models can claim skill", () => {
  const task = validBinaryTask();
  task.baseline_suite = ["transformer"];
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("mandatory_baseline_missing:base_rate"));
  assert.ok(result.reasons.includes("mandatory_baseline_missing:persistence"));
});

test("requires a protocol-approved proper primary score", () => {
  const task = validBinaryTask();
  task.metrics.primary = "accuracy";
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("primary_metric_not_protocol_approved_for_target"));
});

test("forbids a scientific calibration claim from a tiny resolved sample", () => {
  const task = validBinaryTask();
  task.calibration.minimum_resolved_forecasts_for_claim = 30;
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("calibration_claim_sample_below_protocol_minimum"));
});

test("requires fail-closed abstention triggers", () => {
  const task = validBinaryTask();
  task.abstention.triggers = ["knowledge_time_unverified"];
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("abstention_trigger_missing:source_coverage_insufficient"));
  assert.ok(result.reasons.includes("abstention_trigger_missing:calibration_insufficient"));
  assert.ok(result.reasons.includes("abstention_trigger_missing:severe_distribution_shift"));
  assert.ok(result.reasons.includes("abstention_trigger_missing:excessive_model_disagreement"));
});

test("requires immutable sealed forecasts with reproducibility hashes", () => {
  const task = validBinaryTask();
  task.ledger.immutable_after_seal = false;
  task.ledger.required_hashes = ["git_commit_sha"];
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("ledger_must_be_immutable_after_seal"));
  assert.ok(result.reasons.includes("ledger_hash_missing:data_manifest_hash"));
  assert.ok(result.reasons.includes("ledger_hash_missing:feature_manifest_hash"));
  assert.ok(result.reasons.includes("ledger_hash_missing:model_artifact_hash"));
});

test("forbids automatic operational model promotion", () => {
  const task = validBinaryTask();
  task.promotion.no_auto_promotion = false;
  task.promotion.requires_prospective_evidence_for_operational_use = false;
  const result = validateForecastTask(task);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("promotion_must_forbid_auto_promotion"));
  assert.ok(result.reasons.includes("promotion_must_require_prospective_evidence_for_operational_use"));
});

test("prevents predictive tasks from silently claiming causality", () => {
  const result = validateForecastTask(validBinaryTask({ claim_semantics: "causal_effect_proven" }));
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("claim_semantics_must_remain_predictive_not_causal"));
});

test("throws instead of accepting an incomplete scientific task", () => {
  assert.throws(
    () => assertValidForecastTask(validBinaryTask({ baseline_suite: [] })),
    (error) => {
      assert.equal(error.code, "AICIS_FORECAST_TASK_PROTOCOL_REJECTED");
      assert.ok(error.reasons.includes("baseline_suite_missing"));
      return true;
    },
  );
});
