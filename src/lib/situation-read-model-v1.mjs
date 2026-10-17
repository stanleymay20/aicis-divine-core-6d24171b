const VALID_FEEDBACK = new Set(["confirmed", "rejected", "unclear"]);

const asArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];

const sortedUnique = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const finiteOrNull = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

const timestampMs = (value) => {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const earliestIso = (values) => {
  const valid = values
    .map((value) => ({ value, ms: timestampMs(value) }))
    .filter((entry) => entry.ms !== null)
    .sort((left, right) => left.ms - right.ms);
  return valid[0]?.value ?? null;
};

const latestIso = (values) => {
  const valid = values
    .map((value) => ({ value, ms: timestampMs(value) }))
    .filter((entry) => entry.ms !== null)
    .sort((left, right) => right.ms - left.ms);
  return valid[0]?.value ?? null;
};

const sourceIdentifier = (signal) => {
  const value = signal?.canonical_source_name || signal?.primary_source;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

/**
 * Only a verified duplicate relationship is allowed to collapse two reports.
 * Candidate or legacy / unverified duplicate hints remain separate Situations.
 */
export const situationKeyForSignalV1 = (signal) => {
  if (!signal || typeof signal.id !== "string" || !signal.id) return null;

  if (
    signal.canonical_event_status === "duplicate" &&
    signal.duplicate_match_status === "verified"
  ) {
    const target = signal.canonical_event_id || signal.duplicate_of_signal_id;
    return typeof target === "string" && target ? target : signal.id;
  }

  if (signal.canonical_event_status === "canonical") {
    const target = signal.canonical_event_id;
    return typeof target === "string" && target ? target : signal.id;
  }

  return signal.id;
};

const representativeFor = (key, members) => {
  const direct = members.find((member) => member.id === key);
  if (direct) return direct;

  const canonical = members.find((member) => member.canonical_event_status === "canonical");
  if (canonical) return canonical;

  return [...members].sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
};

const identityStatusFor = (representative, members) => {
  if (representative?.canonical_event_status === "canonical" || members.length > 1) {
    return "verified_canonical_group";
  }
  if (
    representative?.canonical_event_status === "duplicate" &&
    representative?.duplicate_match_status !== "verified"
  ) {
    return "unresolved_duplicate_candidate";
  }
  return "standalone_signal";
};

const corroborationFor = (representative) => {
  const count = finiteOrNull(representative?.corroboration_count);
  if (representative?.multi_source_confirmed === true && count !== null && count >= 2) {
    return {
      state: "established",
      independentOriginCount: count,
      semantics: "existing_record_explicitly_reports_multi_source_confirmation",
    };
  }
  if (representative?.multi_source_confirmed === false) {
    return {
      state: "not_established",
      independentOriginCount: null,
      semantics: "existing_record_does_not_establish_independent_corroboration",
    };
  }
  return {
    state: "unknown",
    independentOriginCount: null,
    semantics: "source_identifier_count_is_not_independent_corroboration",
  };
};

const reviewStateFor = (feedbackRows) => {
  const rows = feedbackRows
    .filter((row) => VALID_FEEDBACK.has(row?.feedback))
    .map((row) => ({ ...row, _ms: timestampMs(row.created_at) ?? -1 }));

  if (rows.length === 0) return { state: "unreviewed", count: 0, latestAt: null };

  const values = new Set(rows.map((row) => row.feedback));
  if (values.has("confirmed") && values.has("rejected")) {
    return {
      state: "conflicted",
      count: rows.length,
      latestAt: latestIso(rows.map((row) => row.created_at)),
    };
  }

  if (values.size === 1) {
    return {
      state: [...values][0],
      count: rows.length,
      latestAt: latestIso(rows.map((row) => row.created_at)),
    };
  }

  const latest = [...rows].sort((left, right) => {
    if (right._ms !== left._ms) return right._ms - left._ms;
    return String(right.signal_id ?? "").localeCompare(String(left.signal_id ?? ""));
  })[0];

  return {
    state: latest?.feedback ?? "unreviewed",
    count: rows.length,
    latestAt: latest?.created_at ?? null,
  };
};

const operationalStateFor = (rows) => {
  if (rows.length === 0) {
    return {
      state: "not_recorded",
      recordCount: 0,
      outcomeCount: 0,
      semantics: "no_linked_decision_outcome_record",
    };
  }

  const observed = rows.filter((row) => typeof row?.outcome_success === "boolean");
  if (observed.length > 0) {
    return {
      state: "outcome_observed",
      recordCount: rows.length,
      outcomeCount: observed.length,
      semantics: "operational_outcome_record_not_scientific_forecast_resolution",
    };
  }

  if (rows.some((row) => row?.action_taken === true)) {
    return {
      state: "action_recorded",
      recordCount: rows.length,
      outcomeCount: 0,
      semantics: "operational_action_recorded_outcome_not_yet_observed",
    };
  }

  return {
    state: "recorded",
    recordCount: rows.length,
    outcomeCount: 0,
    semantics: "decision_outcome_record_exists_without_observed_outcome",
  };
};

/**
 * Deterministic read-only Situation projection.
 *
 * This function intentionally does not create forecast probabilities, infer source
 * independence from publisher counts, or manufacture a contradiction state.
 */
export const buildSituationsV1 = ({ signals = [], feedback = [], outcomes = [] } = {}) => {
  const groups = new Map();

  for (const signal of signals) {
    const key = situationKeyForSignalV1(signal);
    if (!key) continue;
    const current = groups.get(key) ?? [];
    current.push(signal);
    groups.set(key, current);
  }

  const feedbackBySignal = new Map();
  for (const row of feedback) {
    if (!row?.signal_id) continue;
    const current = feedbackBySignal.get(row.signal_id) ?? [];
    current.push(row);
    feedbackBySignal.set(row.signal_id, current);
  }

  const outcomesBySignal = new Map();
  for (const row of outcomes) {
    if (!row?.signal_id) continue;
    const current = outcomesBySignal.get(row.signal_id) ?? [];
    current.push(row);
    outcomesBySignal.set(row.signal_id, current);
  }

  const situations = [];

  for (const [key, members] of groups.entries()) {
    const representative = representativeFor(key, members);
    if (!representative) continue;

    const memberIds = members.map((member) => member.id);
    const situationFeedback = memberIds.flatMap((id) => feedbackBySignal.get(id) ?? []);
    const situationOutcomes = memberIds.flatMap((id) => outcomesBySignal.get(id) ?? []);
    const review = reviewStateFor(situationFeedback);
    const operational = operationalStateFor(situationOutcomes);
    const sourceIdentifiers = sortedUnique(members.map(sourceIdentifier).filter(Boolean));
    const affectedCountries = sortedUnique(members.flatMap((member) => asArray(member.affected_countries)));
    const affectedRegions = sortedUnique(members.flatMap((member) => asArray(member.affected_regions)));
    const affectedSectors = sortedUnique(members.flatMap((member) => asArray(member.affected_sectors)));
    const affectedStakeholders = sortedUnique(members.flatMap((member) => asArray(member.affected_stakeholders)));
    const corroboration = corroborationFor(representative);
    const identityStatus = identityStatusFor(representative, members);

    const firstDetectedAt = earliestIso(members.map((member) => member.first_detected_at));
    const latestObservedAt = latestIso(
      members.flatMap((member) => [member.latest_update_at, member.first_detected_at, member.ingested_at]),
    );

    const needsReview =
      review.state === "unreviewed" ||
      review.state === "unclear" ||
      review.state === "conflicted" ||
      identityStatus === "unresolved_duplicate_candidate";

    situations.push({
      id: key,
      representativeSignalId: representative.id,
      memberSignalIds: [...memberIds].sort((a, b) => a.localeCompare(b)),
      title: representative.title || "Untitled situation",
      summary: representative.summary ?? null,
      category: representative.category ?? null,
      signalStatus: representative.status ?? null,
      identityStatus,
      reportCount: members.length,
      sourceIdentifiers,
      sourceIdentifierCount: sourceIdentifiers.length,
      sourceIdentifierSemantics: "descriptive_source_identifiers_not_source_independence",
      corroboration,
      contradiction: {
        state: "unknown_not_modeled",
        semantics: "v1_has_no_governed_source_claim_contradiction_graph",
      },
      affectedCountries,
      affectedRegions,
      affectedSectors,
      affectedStakeholders,
      firstDetectedAt,
      latestObservedAt,
      occurredAt: earliestIso(members.map((member) => member.occurred_at)),
      signalTrustScore: finiteOrNull(representative.confidence_score),
      signalTrustSemantics: "signal_evidence_screen_not_forecast_probability",
      impactScore: finiteOrNull(representative.impact_score),
      urgencyScore: finiteOrNull(representative.urgency_score),
      sourceTrustTier: representative.source_trust_tier ?? null,
      officialSourcePresent: typeof representative.official_source_present === "boolean"
        ? representative.official_source_present
        : null,
      uncertaintyNotes: representative.uncertainty_notes ?? null,
      enrichmentStatus: representative.enrichment_status ?? null,
      review,
      operational,
      forecast: {
        state: "not_linked",
        probability: null,
        semantics: "requires_registered_sealed_forecast_under_scientific_protocol",
      },
      coverage: {
        sourceIdentity: sourceIdentifiers.length > 0 ? "present" : "unknown",
        geography: affectedCountries.length > 0 || affectedRegions.length > 0 ? "present" : "unknown",
        affectedContext: affectedSectors.length > 0 || affectedStakeholders.length > 0 ? "present" : "unknown",
        timing: firstDetectedAt ? "present" : "unknown",
        corroboration: corroboration.state,
        contradictions: "unknown_not_modeled",
      },
      needsReview,
    });
  }

  return situations.sort((left, right) => {
    const leftMs = timestampMs(left.latestObservedAt) ?? -1;
    const rightMs = timestampMs(right.latestObservedAt) ?? -1;
    if (rightMs !== leftMs) return rightMs - leftMs;
    return left.id.localeCompare(right.id);
  });
};
