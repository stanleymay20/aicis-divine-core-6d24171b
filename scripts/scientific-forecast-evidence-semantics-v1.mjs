const EVIDENCE_CLASSES = new Set([
  "retrospective_backtest",
  "prospective_shadow",
  "prospective_operational",
]);

function parseTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function requireTimestamp(record, field, reason) {
  const ms = parseTimestamp(record?.[field]);
  if (ms === null) {
    const error = new Error(reason);
    error.code = "AICIS_FORECAST_EVIDENCE_SEMANTICS_REJECTED";
    error.reason = reason;
    throw error;
  }
  return { value: record[field], ms };
}

export function scientificIssuanceTime(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    const error = new Error("forecast_evidence_record_missing_or_invalid");
    error.code = "AICIS_FORECAST_EVIDENCE_SEMANTICS_REJECTED";
    error.reason = "forecast_evidence_record_missing_or_invalid";
    throw error;
  }

  if (!EVIDENCE_CLASSES.has(record.evidence_class)) {
    const error = new Error("forecast_evidence_class_invalid");
    error.code = "AICIS_FORECAST_EVIDENCE_SEMANTICS_REJECTED";
    error.reason = "forecast_evidence_class_invalid";
    throw error;
  }

  if (record.evidence_class === "retrospective_backtest") {
    return requireTimestamp(
      record,
      "forecast_origin",
      "retrospective_forecast_origin_missing_or_invalid",
    ).value;
  }

  // Prospective scientific evidence is only as old as its immutable database seal.
  // A caller-supplied logical forecast_origin must never be used to claim that a
  // prospective prediction was issued earlier than the database can prove.
  return requireTimestamp(
    record,
    "sealed_at",
    "prospective_database_seal_time_missing_or_invalid",
  ).value;
}

export function evaluateScientificForecastEvidenceChronology(record) {
  const reasons = [];

  let issuance;
  try {
    issuance = parseTimestamp(scientificIssuanceTime(record));
  } catch (error) {
    reasons.push(error.reason ?? "scientific_issuance_time_invalid");
    return { valid: false, reasons };
  }

  const targetStart = parseTimestamp(record.target_window_start);
  const targetEnd = parseTimestamp(record.target_window_end);
  const knowledgeCutoff = parseTimestamp(record.knowledge_cutoff);
  const forecastOrigin = parseTimestamp(record.forecast_origin);
  const sealedAt = parseTimestamp(record.sealed_at);

  if (targetStart === null) reasons.push("target_window_start_missing_or_invalid");
  if (targetEnd === null) reasons.push("target_window_end_missing_or_invalid");
  if (knowledgeCutoff === null) reasons.push("knowledge_cutoff_missing_or_invalid");
  if (forecastOrigin === null) reasons.push("forecast_origin_missing_or_invalid");
  if (sealedAt === null) reasons.push("sealed_at_missing_or_invalid");

  if (targetStart !== null && targetEnd !== null && targetEnd <= targetStart) {
    reasons.push("target_window_not_positive");
  }
  if (knowledgeCutoff !== null && forecastOrigin !== null && knowledgeCutoff > forecastOrigin) {
    reasons.push("knowledge_cutoff_after_forecast_origin");
  }
  if (targetStart !== null && issuance !== null && issuance > targetStart) {
    reasons.push("scientific_issuance_after_target_window_start");
  }

  if (record.evidence_class === "retrospective_backtest") {
    if (targetEnd !== null && sealedAt !== null && targetEnd > sealedAt) {
      reasons.push("retrospective_target_window_not_completed_at_seal");
    }
  } else if (sealedAt !== null && issuance !== sealedAt) {
    reasons.push("prospective_issuance_must_equal_database_seal_time");
  }

  return { valid: reasons.length === 0, reasons };
}
