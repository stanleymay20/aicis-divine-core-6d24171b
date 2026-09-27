
export const STRATEGIC_DOCTRINE_LEARNING_VERSION = "aicis-strategic-doctrine-learning-v1";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

function wilson(successes, total, z = 1.96) {
  if (!Number.isInteger(total) || total <= 0) return { lower: null, upper: null };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (
    z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  ) / denominator;
  return {
    lower: round(Math.max(0, center - margin), 4),
    upper: round(Math.min(1, center + margin), 4),
  };
}

function auditHashValid(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function uniqueDecisionRows(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (!row?.decision_id) continue;
    const id = String(row.decision_id);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const duplicateIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const duplicateSet = new Set(duplicateIds);
  return {
    unique_rows: rows.filter((row) => row?.decision_id && !duplicateSet.has(String(row.decision_id))),
    duplicate_decision_ids: duplicateIds,
  };
}

function doctrineIds(row) {
  return [...new Set(list(row?.doctrine_ids).map(String).filter(Boolean))];
}

function evidenceUsable(row) {
  if (row?.outcome_verified === true) return true;
  return finite(row?.evidence_quality_score) && row.evidence_quality_score >= 70;
}

function associationState(sampleCount, avgIncrementalValue, successRate) {
  if (sampleCount < 10) return "insufficient_observations";
  if (finite(avgIncrementalValue)) {
    if (avgIncrementalValue > 0) return "positive_observed_association";
    if (avgIncrementalValue < 0) return "negative_observed_association";
  }
  if (finite(successRate)) {
    if (successRate >= 0.6) return "positive_observed_association";
    if (successRate <= 0.4) return "negative_observed_association";
  }
  return "mixed_or_neutral_observed_association";
}

export function evaluateDoctrineOutcomes(outcomes = []) {
  const rows = list(outcomes);
  const deduped = uniqueDecisionRows(rows);
  const usableRows = deduped.unique_rows;
  const byDoctrine = new Map();

  for (const row of usableRows) {
    if (!row?.decision_id) continue;
    if (!evidenceUsable(row)) continue;

    const ids = doctrineIds(row);
    if (!ids.length) continue;

    for (const doctrineId of ids) {
      const bucket = byDoctrine.get(doctrineId) || [];
      bucket.push(row);
      byDoctrine.set(doctrineId, bucket);
    }
  }

  const doctrines = [...byDoctrine.entries()].map(([doctrineId, bucket]) => {
    const realizedRows = bucket.filter((row) => finite(row.realized_net_value));
    const comparatorRows = bucket.filter((row) =>
      finite(row.realized_net_value) && finite(row.baseline_net_value)
    );
    const successRows = bucket.filter((row) => typeof row.outcome_success === "boolean");
    const successes = successRows.filter((row) => row.outcome_success).length;

    const realizedValues = realizedRows.map((row) => row.realized_net_value);
    const incrementalValues = comparatorRows.map((row) =>
      row.realized_net_value - row.baseline_net_value
    );
    const average = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;

    const avgRealized = average(realizedValues);
    const avgIncremental = average(incrementalValues);
    const successRate = successRows.length ? successes / successRows.length : null;
    const interval = wilson(successes, successRows.length);

    const domains = {};
    for (const row of bucket) {
      const domain = String(row.domain || "unknown");
      domains[domain] = (domains[domain] || 0) + 1;
    }

    return {
      doctrine_id: doctrineId,
      verified_observation_count: bucket.length,
      realized_value_count: realizedRows.length,
      comparator_count: comparatorRows.length,
      success_observation_count: successRows.length,
      success_rate: finite(successRate) ? round(successRate, 4) : null,
      success_rate_wilson_95: interval,
      average_realized_net_value: finite(avgRealized) ? round(avgRealized, 2) : null,
      average_incremental_value_vs_supplied_baseline: finite(avgIncremental)
        ? round(avgIncremental, 2)
        : null,
      domains,
      audit_linked_count: bucket.filter((row) => auditHashValid(row.strategic_audit_hash)).length,
      audit_unlinked_count: bucket.filter((row) => !auditHashValid(row.strategic_audit_hash)).length,
      evidence_state: associationState(bucket.length, avgIncremental, successRate),
      causal_attribution_allowed: false,
      promotion_eligible: false,
      interpretation: "Observed outcome association only. Doctrine presence may be confounded by domain, user selection, opportunity quality, timing, and other strategy components.",
    };
  }).sort((a, b) => b.verified_observation_count - a.verified_observation_count);

  return {
    evaluator_version: STRATEGIC_DOCTRINE_LEARNING_VERSION,
    supplied_outcome_count: rows.length,
    unique_decision_count: usableRows.length,
    duplicate_decision_ids: deduped.duplicate_decision_ids,
    duplicate_outcome_count: rows.length - usableRows.length,
    usable_outcome_count: usableRows.filter((row) => evidenceUsable(row) && doctrineIds(row).length).length,
    audit_linked_usable_outcome_count: usableRows.filter((row) =>
      evidenceUsable(row) &&
      doctrineIds(row).length &&
      auditHashValid(row.strategic_audit_hash)
    ).length,
    doctrines,
    causal_claim_allowed: false,
    automatic_doctrine_promotion_allowed: false,
    next_validation_requirements: [
      "pre-register doctrine hypothesis and outcome metric",
      "define a credible comparison strategy or matched control",
      "control for domain and opportunity quality",
      "use point-in-time inputs and realized outcomes",
      "evaluate out of sample",
      "review adverse and failed cases, not only successes",
    ],
    scope_notice: "This evaluator measures associations between doctrine use and observed outcomes. It does not prove that a doctrine caused the outcome and must not automatically promote a doctrine to validated status.",
  };
}
