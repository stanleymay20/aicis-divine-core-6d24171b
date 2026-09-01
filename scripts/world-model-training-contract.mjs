const ALLOWED_GROUND_TRUTH_LABEL_SOURCES = new Set([
  "observed_future_metric",
  "forecast_ground_truth",
]);

const VERIFIED_EVIDENCE_STATUSES = new Set([
  "verified",
  "validated",
  "ground_truth",
  "human_verified",
]);

const EXAMPLE_KINDS = new Set(["state_transition", "forecast_outcome"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const HOUR_MS = 60 * 60 * 1000;
const HORIZON_TOLERANCE_MS = 1000;

export const WORLD_MODEL_CONTRACT_VERSION = "aicis-world-model-training-v1";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneAndDeepFreeze(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);

  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);

  if (Array.isArray(value)) {
    for (const item of value) clone.push(cloneAndDeepFreeze(item, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneAndDeepFreeze(item, seen);
    }
  }

  return Object.freeze(clone);
}

export function evaluateTrainingCandidate(candidate) {
  const reasons = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { admissible: false, reasons: ["candidate_missing_or_invalid"] };
  }

  if (!EXAMPLE_KINDS.has(candidate.example_kind)) reasons.push("example_kind_invalid");
  if (!hasText(candidate.observation_id)) reasons.push("observation_id_missing");
  if (!hasText(candidate.label_id)) reasons.push("label_id_missing");

  const observedAt = parseTimestamp(candidate.observed_at);
  const cutoffAt = parseTimestamp(candidate.historical_cutoff_at);
  const horizonEndAt = parseTimestamp(candidate.label_horizon_end_at);
  const labelObservedAt = parseTimestamp(candidate.label_observed_at);
  const knowledgeTimeVerifiedAt = parseTimestamp(candidate.knowledge_time_verified_at);

  if (observedAt === null) reasons.push("observed_at_missing_or_invalid");
  if (cutoffAt === null) reasons.push("historical_cutoff_at_missing_or_invalid");
  if (horizonEndAt === null) reasons.push("label_horizon_end_at_missing_or_invalid");
  if (labelObservedAt === null) reasons.push("label_observed_at_missing_or_invalid");
  if (knowledgeTimeVerifiedAt === null) reasons.push("knowledge_time_verified_at_missing_or_invalid");

  if (observedAt !== null && cutoffAt !== null && cutoffAt < observedAt) {
    reasons.push("historical_cutoff_predates_observation");
  }

  if (cutoffAt !== null && horizonEndAt !== null && horizonEndAt <= cutoffAt) {
    reasons.push("label_horizon_not_after_historical_cutoff");
  }

  if (horizonEndAt !== null && labelObservedAt !== null && labelObservedAt < horizonEndAt) {
    reasons.push("label_observed_before_horizon_end");
  }

  if (candidate.knowledge_time_status !== "verified_leakage_safe") {
    reasons.push("knowledge_time_not_verified_leakage_safe");
  }
  if (!hasText(candidate.knowledge_time_proof_version)) {
    reasons.push("knowledge_time_proof_version_missing");
  }
  if (!hasText(candidate.knowledge_time_proof_sha256) || !SHA256_RE.test(candidate.knowledge_time_proof_sha256)) {
    reasons.push("knowledge_time_proof_sha256_invalid");
  }
  if (!hasText(candidate.knowledge_time_verification_method)) {
    reasons.push("knowledge_time_verification_method_missing");
  }

  const hasOutcomeText = hasText(candidate.realized_outcome);
  const hasLabelValue = candidate.label_value !== null && candidate.label_value !== undefined;
  if (!hasOutcomeText && !hasLabelValue) reasons.push("ground_truth_label_missing");
  if (hasLabelValue && !isFiniteNumber(candidate.label_value) && typeof candidate.label_value !== "boolean") {
    reasons.push("label_value_invalid");
  }

  if (!hasText(candidate.label_source)) {
    reasons.push("label_source_missing");
  } else if (!ALLOWED_GROUND_TRUTH_LABEL_SOURCES.has(candidate.label_source.trim().toLowerCase())) {
    reasons.push("label_source_not_ground_truth");
  }

  if (!hasText(candidate.evidence_status)) {
    reasons.push("evidence_status_missing");
  } else if (!VERIFIED_EVIDENCE_STATUSES.has(candidate.evidence_status.trim().toLowerCase())) {
    reasons.push("evidence_not_verified");
  }

  if (!Array.isArray(candidate.source_record_ids) || candidate.source_record_ids.length === 0) {
    reasons.push("source_record_ids_missing");
  } else if (candidate.source_record_ids.some((id) => !hasText(id))) {
    reasons.push("source_record_ids_invalid");
  }

  if (!Array.isArray(candidate.source_names) || candidate.source_names.length === 0) {
    reasons.push("source_names_missing");
  } else if (candidate.source_names.some((name) => !hasText(name))) {
    reasons.push("source_names_invalid");
  }

  if (candidate.is_synthetic === true) {
    reasons.push("synthetic_candidate_forbidden");
  } else if (candidate.is_synthetic !== false) {
    reasons.push("synthetic_status_not_explicitly_false");
  }

  if (candidate.is_backfilled_without_provenance === true) {
    reasons.push("unprovenanced_backfill_forbidden");
  } else if (candidate.is_backfilled_without_provenance !== false) {
    reasons.push("backfill_provenance_status_not_explicitly_false");
  }

  if (candidate.realized_impact !== null && candidate.realized_impact !== undefined) {
    if (!isFiniteNumber(candidate.realized_impact)) reasons.push("realized_impact_invalid");
  }

  if (candidate.example_kind === "forecast_outcome") {
    if (!hasText(candidate.forecast_id)) reasons.push("forecast_id_missing");
    const forecastCreatedAt = parseTimestamp(candidate.forecast_created_at);
    const forecastHorizonHours = candidate.forecast_horizon_hours;

    if (forecastCreatedAt === null) {
      reasons.push("forecast_created_at_missing_or_invalid");
    } else {
      if (cutoffAt !== null && forecastCreatedAt < cutoffAt) reasons.push("forecast_predates_historical_cutoff");
      if (horizonEndAt !== null && forecastCreatedAt >= horizonEndAt) {
        reasons.push("forecast_not_before_target_horizon_end");
      }
      if (labelObservedAt !== null && labelObservedAt <= forecastCreatedAt) {
        reasons.push("label_not_strictly_after_forecast");
      }
    }

    if (!isFiniteNumber(forecastHorizonHours) || forecastHorizonHours <= 0) {
      reasons.push("forecast_horizon_hours_invalid");
    } else if (forecastCreatedAt !== null && horizonEndAt !== null) {
      const declaredEndAt = forecastCreatedAt + forecastHorizonHours * HOUR_MS;
      if (Math.abs(declaredEndAt - horizonEndAt) > HORIZON_TOLERANCE_MS) {
        reasons.push("forecast_horizon_inconsistent_with_target_end");
      }
    }

    if (candidate.forecast_probability !== null && candidate.forecast_probability !== undefined) {
      if (!isFiniteNumber(candidate.forecast_probability)) {
        reasons.push("forecast_probability_invalid");
      } else if (candidate.forecast_probability < 0 || candidate.forecast_probability > 1) {
        reasons.push("forecast_probability_out_of_unit_interval");
      }
    }
  }

  return { admissible: reasons.length === 0, reasons };
}

export function buildAdmittedTrainingExample(candidate) {
  const evaluation = evaluateTrainingCandidate(candidate);
  if (!evaluation.admissible) {
    const error = new Error(`Training candidate rejected: ${evaluation.reasons.join(", ")}`);
    error.code = "AICIS_WORLD_MODEL_CANDIDATE_REJECTED";
    error.reasons = evaluation.reasons;
    throw error;
  }

  const admitted = {
    contract_version: WORLD_MODEL_CONTRACT_VERSION,
    example_kind: candidate.example_kind,
    observation: {
      id: candidate.observation_id,
      observed_at: candidate.observed_at,
      historical_cutoff_at: candidate.historical_cutoff_at,
      domain: candidate.domain ?? null,
      regions: Array.isArray(candidate.regions) ? candidate.regions : [],
      raw_features: candidate.raw_features ?? {},
      derived_features: candidate.derived_features ?? {},
    },
    forecast: candidate.example_kind === "forecast_outcome"
      ? {
          id: candidate.forecast_id,
          created_at: candidate.forecast_created_at,
          horizon_hours: candidate.forecast_horizon_hours,
          probability: candidate.forecast_probability ?? null,
        }
      : null,
    ground_truth: {
      id: candidate.label_id,
      label_value: candidate.label_value ?? null,
      realized_outcome: candidate.realized_outcome ?? null,
      realized_impact: candidate.realized_impact ?? null,
      horizon_end_at: candidate.label_horizon_end_at,
      observed_at: candidate.label_observed_at,
      label_source: candidate.label_source,
      evidence_status: candidate.evidence_status,
    },
    provenance: {
      source_record_ids: candidate.source_record_ids,
      source_names: candidate.source_names,
      knowledge_time_status: candidate.knowledge_time_status,
      knowledge_time_proof_version: candidate.knowledge_time_proof_version,
      knowledge_time_proof_sha256: candidate.knowledge_time_proof_sha256,
      knowledge_time_verified_at: candidate.knowledge_time_verified_at,
      knowledge_time_verification_method: candidate.knowledge_time_verification_method,
    },
  };

  return cloneAndDeepFreeze(admitted);
}
