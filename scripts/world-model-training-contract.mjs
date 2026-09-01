const NON_GROUND_TRUTH_LABEL_SOURCES = new Set([
  "model_score",
  "heuristic_score",
  "derived_score",
  "synthetic",
  "legacy_unknown",
]);

const VERIFIED_EVIDENCE_STATUSES = new Set([
  "verified",
  "validated",
  "ground_truth",
  "human_verified",
]);

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

export function evaluateTrainingCandidate(candidate) {
  const reasons = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { admissible: false, reasons: ["candidate_missing_or_invalid"] };
  }

  if (!hasText(candidate.observation_id)) reasons.push("observation_id_missing");
  if (!hasText(candidate.forecast_id)) reasons.push("forecast_id_missing");
  if (!hasText(candidate.ground_truth_id)) reasons.push("ground_truth_id_missing");

  const observedAt = parseTimestamp(candidate.observed_at);
  const forecastCreatedAt = parseTimestamp(candidate.forecast_created_at);
  const validatedAt = parseTimestamp(candidate.validated_at);

  if (observedAt === null) reasons.push("observed_at_missing_or_invalid");
  if (forecastCreatedAt === null) reasons.push("forecast_created_at_missing_or_invalid");
  if (validatedAt === null) reasons.push("validated_at_missing_or_invalid");

  if (observedAt !== null && forecastCreatedAt !== null && forecastCreatedAt < observedAt) {
    reasons.push("forecast_predates_observation");
  }

  if (forecastCreatedAt !== null && validatedAt !== null && validatedAt <= forecastCreatedAt) {
    reasons.push("validation_not_strictly_after_forecast");
  }

  if (!hasText(candidate.realized_outcome)) reasons.push("realized_outcome_missing");

  if (
    hasText(candidate.label_source) &&
    NON_GROUND_TRUTH_LABEL_SOURCES.has(candidate.label_source.trim().toLowerCase())
  ) {
    reasons.push("label_source_not_ground_truth");
  }

  if (!hasText(candidate.label_source)) reasons.push("label_source_missing");

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

  if (candidate.is_synthetic === true) reasons.push("synthetic_candidate_forbidden");
  if (candidate.is_backfilled_without_provenance === true) reasons.push("unprovenanced_backfill_forbidden");

  if (candidate.realized_impact !== null && candidate.realized_impact !== undefined) {
    if (!isFiniteNumber(candidate.realized_impact)) reasons.push("realized_impact_invalid");
  }

  if (candidate.forecast_probability !== null && candidate.forecast_probability !== undefined) {
    if (!isFiniteNumber(candidate.forecast_probability)) {
      reasons.push("forecast_probability_invalid");
    } else if (candidate.forecast_probability < 0 || candidate.forecast_probability > 1) {
      reasons.push("forecast_probability_out_of_unit_interval");
    }
  }

  return {
    admissible: reasons.length === 0,
    reasons,
  };
}

export function buildAdmittedTrainingExample(candidate) {
  const evaluation = evaluateTrainingCandidate(candidate);
  if (!evaluation.admissible) {
    const error = new Error(`Training candidate rejected: ${evaluation.reasons.join(", ")}`);
    error.code = "AICIS_WORLD_MODEL_CANDIDATE_REJECTED";
    error.reasons = evaluation.reasons;
    throw error;
  }

  return Object.freeze({
    contract_version: WORLD_MODEL_CONTRACT_VERSION,
    observation: Object.freeze({
      id: candidate.observation_id,
      observed_at: candidate.observed_at,
      domain: candidate.domain ?? null,
      regions: Array.isArray(candidate.regions) ? [...candidate.regions] : [],
      raw_features: candidate.raw_features ?? {},
      derived_features: candidate.derived_features ?? {},
    }),
    forecast: Object.freeze({
      id: candidate.forecast_id,
      created_at: candidate.forecast_created_at,
      horizon_hours: candidate.forecast_horizon_hours ?? null,
      probability: candidate.forecast_probability ?? null,
    }),
    ground_truth: Object.freeze({
      id: candidate.ground_truth_id,
      realized_outcome: candidate.realized_outcome,
      realized_impact: candidate.realized_impact ?? null,
      validated_at: candidate.validated_at,
      label_source: candidate.label_source,
      evidence_status: candidate.evidence_status,
    }),
    provenance: Object.freeze({
      source_record_ids: [...candidate.source_record_ids],
      source_names: [...candidate.source_names],
    }),
  });
}
