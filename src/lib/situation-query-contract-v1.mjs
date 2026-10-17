const finiteNonNegativeIntegerOrNull = (value) =>
  Number.isInteger(value) && value >= 0 ? value : null;

const finiteNonNegativeNumberOrNull = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Classify a read failure without pretending that access denial means "no rows".
 * This is intentionally conservative: only explicit auth / RLS signals become
 * access_denied; everything else remains unavailable.
 */
export const classifySituationReadErrorV1 = (error) => {
  const code = String(error?.code ?? "").toLowerCase();
  const status = Number(error?.status ?? error?.statusCode ?? NaN);
  const text = [error?.message, error?.details, error?.hint]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    code === "42501" ||
    code === "pgrst301" ||
    code === "pgrst302" ||
    /permission denied|row-level security|\brls\b|not authorized|unauthorized|forbidden|jwt/.test(text)
  ) {
    return "access_denied";
  }

  return "unavailable";
};

/**
 * Describe what the configured lookback actually covers.
 * A seven-day lookback is not called exhaustive unless the exact count proves it.
 */
export const buildSituationWindowMetaV1 = ({
  lookbackDays,
  rowLimit,
  returnedSignalRows,
  totalSignalRows,
  queryLatencyMs,
} = {}) => {
  const days = Math.max(1, finiteNonNegativeIntegerOrNull(lookbackDays) ?? 1);
  const limit = Math.max(1, finiteNonNegativeIntegerOrNull(rowLimit) ?? 1);
  const returned = finiteNonNegativeIntegerOrNull(returnedSignalRows) ?? 0;
  const total = finiteNonNegativeIntegerOrNull(totalSignalRows);
  const latency = finiteNonNegativeNumberOrNull(queryLatencyMs);

  let coverageState;
  if (total === null) {
    coverageState = returned >= limit ? "cap_reached_total_unknown" : "total_unknown";
  } else if (total > returned) {
    coverageState = "capped_sample";
  } else if (total === returned) {
    coverageState = "complete_window";
  } else {
    // Count and row reads are separate requests and can race with live ingestion.
    // Never call a contradictory snapshot complete.
    coverageState = "count_inconsistent";
  }

  return {
    lookbackDays: days,
    rowLimit: limit,
    returnedSignalRows: returned,
    totalSignalRows: total,
    queryLatencyMs: latency,
    coverageState,
  };
};
