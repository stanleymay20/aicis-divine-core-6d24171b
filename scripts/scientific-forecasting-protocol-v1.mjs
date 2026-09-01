export const SCIENTIFIC_FORECASTING_PROTOCOL_VERSION = "aicis-scientific-forecasting-protocol-v1";

const TARGET_TYPES = new Set([
  "binary",
  "count",
  "continuous",
  "time_to_event",
  "event_sequence",
  "graph_link",
  "ranking",
]);

const GEOGRAPHY_LEVELS = new Set([
  "grid",
  "city",
  "admin1",
  "country",
  "region",
  "global",
  "entity",
  "network",
]);

const HORIZON_UNITS = new Set(["hours", "days"]);
const REVISION_POLICIES = new Set([
  "first_release",
  "latest_available",
  "final_vintage",
  "versioned_as_of_resolution",
]);

const GROUND_TRUTH_AUTHORITY_CLASSES = new Set([
  "official_statistics",
  "governed_event_dataset",
  "primary_source",
  "independently_adjudicated",
  "registered_operational_outcome",
]);

const PROPER_PRIMARY_SCORES = {
  binary: new Set(["brier", "log_loss"]),
  count: new Set(["crps", "log_score"]),
  continuous: new Set(["crps", "log_score"]),
  time_to_event: new Set(["log_score", "negative_log_likelihood"]),
  event_sequence: new Set(["log_score", "negative_log_likelihood"]),
  graph_link: new Set(["brier", "log_loss"]),
  ranking: new Set(["log_loss", "brier"]),
};

const MANDATORY_BASELINES = {
  binary: ["base_rate", "persistence"],
  count: ["historical_rate", "persistence"],
  continuous: ["persistence", "seasonal_naive"],
  time_to_event: ["historical_intensity"],
  event_sequence: ["historical_intensity"],
  graph_link: ["recurrence", "frequency"],
  ranking: ["prior_rank", "frequency"],
};

const REQUIRED_ABSTENTION_TRIGGERS = new Set([
  "knowledge_time_unverified",
  "source_coverage_insufficient",
  "calibration_insufficient",
  "severe_distribution_shift",
  "excessive_model_disagreement",
]);

const REQUIRED_LEDGER_HASHES = new Set([
  "data_manifest_hash",
  "feature_manifest_hash",
  "model_artifact_hash",
  "git_commit_sha",
]);

const REQUIRED_EVALUATION_MODES = new Set([
  "retrospective_rolling_origin",
  "prospective_sealed",
]);

export const SCIENTIFIC_FORECASTING_PROTOCOL = Object.freeze({
  version: SCIENTIFIC_FORECASTING_PROTOCOL_VERSION,
  knowledge_time_policy: "verified_point_in_time_v1",
  split_policy: "knowledge_time_bounded_rolling_origin",
  causal_claim_policy: "predictive_not_causal_without_identification",
  minimum_forecast_origins: 3,
  minimum_resolved_forecasts_for_calibration_claim: 100,
  minimum_resolved_forecasts_for_operational_promotion: 100,
  required_abstention_triggers: Object.freeze([...REQUIRED_ABSTENTION_TRIGGERS]),
  required_ledger_hashes: Object.freeze([...REQUIRED_LEDGER_HASHES]),
});

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedStringSet(value) {
  return new Set(asArray(value).filter(hasText).map((item) => item.trim().toLowerCase()));
}

function requireText(object, key, reasons, reason) {
  if (!object || typeof object !== "object" || Array.isArray(object) || !hasText(object[key])) {
    reasons.push(reason);
    return null;
  }
  return object[key].trim();
}

function validateTarget(task, reasons) {
  const target = task.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    reasons.push("target_missing_or_invalid");
    return null;
  }

  const type = requireText(target, "type", reasons, "target_type_missing");
  if (type && !TARGET_TYPES.has(type)) reasons.push("target_type_unsupported");
  requireText(target, "definition", reasons, "target_definition_missing");
  requireText(target, "outcome_field", reasons, "target_outcome_field_missing");
  return type;
}

function validateHorizon(task, reasons) {
  const horizon = task.horizon;
  if (!horizon || typeof horizon !== "object" || Array.isArray(horizon)) {
    reasons.push("horizon_missing_or_invalid");
    return;
  }
  if (!isPositiveInteger(horizon.value)) reasons.push("horizon_value_must_be_positive_integer");
  if (!HORIZON_UNITS.has(horizon.unit)) reasons.push("horizon_unit_unsupported");
}

function validateResolution(task, reasons) {
  const resolution = task.resolution;
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) {
    reasons.push("resolution_missing_or_invalid");
    return;
  }
  requireText(resolution, "authority", reasons, "resolution_authority_missing");
  requireText(resolution, "outcome_query", reasons, "resolution_outcome_query_missing");
  if (!REVISION_POLICIES.has(resolution.revision_policy)) reasons.push("resolution_revision_policy_unsupported");
  if (!GROUND_TRUTH_AUTHORITY_CLASSES.has(resolution.authority_class)) {
    reasons.push("resolution_authority_class_unsupported");
  }
}

function validateBaselines(task, targetType, reasons) {
  const baselines = normalizedStringSet(task.baseline_suite);
  if (baselines.size === 0) {
    reasons.push("baseline_suite_missing");
    return;
  }
  if (!targetType || !MANDATORY_BASELINES[targetType]) return;
  for (const baseline of MANDATORY_BASELINES[targetType]) {
    if (!baselines.has(baseline)) reasons.push(`mandatory_baseline_missing:${baseline}`);
  }
}

function validateMetrics(task, targetType, reasons) {
  const metrics = task.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    reasons.push("metrics_missing_or_invalid");
    return;
  }
  const primary = requireText(metrics, "primary", reasons, "primary_metric_missing");
  if (primary && targetType && PROPER_PRIMARY_SCORES[targetType] && !PROPER_PRIMARY_SCORES[targetType].has(primary)) {
    reasons.push("primary_metric_not_protocol_approved_for_target");
  }
  if (!Array.isArray(metrics.secondary)) reasons.push("secondary_metrics_missing_or_invalid");
}

function validateEvaluation(task, reasons) {
  const evaluation = task.evaluation;
  if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) {
    reasons.push("evaluation_missing_or_invalid");
    return;
  }
  if (evaluation.split_policy !== SCIENTIFIC_FORECASTING_PROTOCOL.split_policy) {
    reasons.push("evaluation_split_policy_must_be_knowledge_time_bounded_rolling_origin");
  }
  if (!isPositiveInteger(evaluation.minimum_forecast_origins)
      || evaluation.minimum_forecast_origins < SCIENTIFIC_FORECASTING_PROTOCOL.minimum_forecast_origins) {
    reasons.push("evaluation_forecast_origins_below_protocol_minimum");
  }
  if (evaluation.test_data_policy !== "future_only_after_model_selection") {
    reasons.push("test_data_policy_must_be_future_only_after_model_selection");
  }
  const modes = normalizedStringSet(evaluation.modes);
  for (const mode of REQUIRED_EVALUATION_MODES) {
    if (!modes.has(mode)) reasons.push(`evaluation_mode_missing:${mode}`);
  }
}

function validateCalibration(task, reasons) {
  const calibration = task.calibration;
  if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    reasons.push("calibration_missing_or_invalid");
    return;
  }
  if (calibration.required !== true) reasons.push("calibration_must_be_required");
  if (!hasText(calibration.method_policy)) reasons.push("calibration_method_policy_missing");
  if (!isPositiveInteger(calibration.minimum_resolved_forecasts_for_claim)
      || calibration.minimum_resolved_forecasts_for_claim < SCIENTIFIC_FORECASTING_PROTOCOL.minimum_resolved_forecasts_for_calibration_claim) {
    reasons.push("calibration_claim_sample_below_protocol_minimum");
  }
}

function validateAbstention(task, reasons) {
  const abstention = task.abstention;
  if (!abstention || typeof abstention !== "object" || Array.isArray(abstention)) {
    reasons.push("abstention_missing_or_invalid");
    return;
  }
  if (abstention.enabled !== true) reasons.push("abstention_must_be_enabled");
  const triggers = normalizedStringSet(abstention.triggers);
  for (const trigger of REQUIRED_ABSTENTION_TRIGGERS) {
    if (!triggers.has(trigger)) reasons.push(`abstention_trigger_missing:${trigger}`);
  }
}

function validatePromotion(task, reasons) {
  const promotion = task.promotion;
  if (!promotion || typeof promotion !== "object" || Array.isArray(promotion)) {
    reasons.push("promotion_missing_or_invalid");
    return;
  }
  if (promotion.no_auto_promotion !== true) reasons.push("promotion_must_forbid_auto_promotion");
  if (promotion.requires_positive_skill_vs_mandatory_baselines !== true) {
    reasons.push("promotion_must_require_positive_skill_vs_mandatory_baselines");
  }
  if (promotion.requires_prospective_evidence_for_operational_use !== true) {
    reasons.push("promotion_must_require_prospective_evidence_for_operational_use");
  }
  if (!isPositiveInteger(promotion.minimum_resolved_forecasts_for_operational_use)
      || promotion.minimum_resolved_forecasts_for_operational_use < SCIENTIFIC_FORECASTING_PROTOCOL.minimum_resolved_forecasts_for_operational_promotion) {
    reasons.push("promotion_resolved_forecasts_below_protocol_minimum");
  }
}

function validateLedger(task, reasons) {
  const ledger = task.ledger;
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    reasons.push("ledger_missing_or_invalid");
    return;
  }
  if (ledger.immutable_after_seal !== true) reasons.push("ledger_must_be_immutable_after_seal");
  if (ledger.seal_before_target_period_evidence !== true) {
    reasons.push("ledger_must_seal_before_target_period_evidence");
  }
  const hashes = normalizedStringSet(ledger.required_hashes);
  for (const hashField of REQUIRED_LEDGER_HASHES) {
    if (!hashes.has(hashField)) reasons.push(`ledger_hash_missing:${hashField}`);
  }
}

export function validateForecastTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return { valid: false, reasons: ["task_missing_or_invalid"] };
  }

  const reasons = [];
  if (task.protocol_version !== SCIENTIFIC_FORECASTING_PROTOCOL_VERSION) {
    reasons.push("protocol_version_mismatch");
  }
  if (!hasText(task.task_id) || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(task.task_id)) {
    reasons.push("task_id_invalid");
  }
  if (!hasText(task.task_version) || !/^\d+\.\d+\.\d+$/.test(task.task_version)) {
    reasons.push("task_version_must_be_semver");
  }
  requireText(task, "title", reasons, "task_title_missing");
  requireText(task, "domain", reasons, "task_domain_missing");
  if (!GEOGRAPHY_LEVELS.has(task.geography_level)) reasons.push("geography_level_unsupported");
  if (task.knowledge_time_policy !== SCIENTIFIC_FORECASTING_PROTOCOL.knowledge_time_policy) {
    reasons.push("knowledge_time_policy_mismatch");
  }

  const targetType = validateTarget(task, reasons);
  validateHorizon(task, reasons);
  validateResolution(task, reasons);
  validateBaselines(task, targetType, reasons);
  validateMetrics(task, targetType, reasons);
  validateEvaluation(task, reasons);
  validateCalibration(task, reasons);
  validateAbstention(task, reasons);
  validatePromotion(task, reasons);
  validateLedger(task, reasons);

  if (task.claim_semantics !== SCIENTIFIC_FORECASTING_PROTOCOL.causal_claim_policy) {
    reasons.push("claim_semantics_must_remain_predictive_not_causal");
  }

  return { valid: reasons.length === 0, reasons };
}

export function assertValidForecastTask(task) {
  const result = validateForecastTask(task);
  if (!result.valid) {
    const error = new Error(`Forecast task rejected: ${result.reasons.join(", ")}`);
    error.code = "AICIS_FORECAST_TASK_PROTOCOL_REJECTED";
    error.reasons = result.reasons;
    throw error;
  }
  return true;
}
