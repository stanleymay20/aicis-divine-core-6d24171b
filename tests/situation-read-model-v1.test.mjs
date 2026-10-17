import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSituationsV1,
  situationKeyForSignalV1,
} from "../src/lib/situation-read-model-v1.mjs";
import {
  buildSituationWindowMetaV1,
  classifySituationReadErrorV1,
} from "../src/lib/situation-query-contract-v1.mjs";

const baseSignal = (overrides = {}) => ({
  id: "signal-a",
  title: "Grid disruption reported",
  summary: "A monitored disruption was reported.",
  category: "infrastructure",
  canonical_event_status: "canonical",
  canonical_event_id: "signal-a",
  duplicate_match_status: null,
  primary_source: "Operator A",
  canonical_source_name: "Operator A",
  confidence_score: null,
  impact_score: 70,
  urgency_score: 65,
  affected_countries: ["DEU"],
  affected_regions: [],
  affected_sectors: ["energy"],
  affected_stakeholders: [],
  first_detected_at: "2026-10-17T10:00:00Z",
  latest_update_at: "2026-10-17T10:05:00Z",
  ingested_at: "2026-10-17T10:00:30Z",
  corroboration_count: null,
  multi_source_confirmed: null,
  ...overrides,
});

test("verified duplicate collapses into canonical Situation", () => {
  const canonical = baseSignal();
  const duplicate = baseSignal({
    id: "signal-b",
    title: "Same disruption from another report",
    canonical_event_status: "duplicate",
    canonical_event_id: "signal-a",
    duplicate_of_signal_id: "signal-a",
    duplicate_match_status: "verified",
    canonical_source_name: "Publisher B",
    primary_source: "Publisher B",
    first_detected_at: "2026-10-17T10:02:00Z",
  });

  const situations = buildSituationsV1({ signals: [canonical, duplicate] });

  assert.equal(situations.length, 1);
  assert.equal(situations[0].id, "signal-a");
  assert.equal(situations[0].reportCount, 2);
  assert.deepEqual(situations[0].sourceIdentifiers, ["Operator A", "Publisher B"]);
});

test("unverified duplicate candidate remains a separate Situation", () => {
  const canonical = baseSignal();
  const candidate = baseSignal({
    id: "signal-c",
    canonical_event_status: "duplicate",
    canonical_event_id: "signal-a",
    duplicate_of_signal_id: "signal-a",
    duplicate_match_status: "candidate",
  });

  assert.equal(situationKeyForSignalV1(candidate), "signal-c");
  const situations = buildSituationsV1({ signals: [canonical, candidate] });
  assert.equal(situations.length, 2);
  assert.equal(
    situations.find((item) => item.id === "signal-c")?.identityStatus,
    "unresolved_duplicate_candidate",
  );
});

test("source identifier count never becomes independent corroboration", () => {
  const canonical = baseSignal();
  const duplicate = baseSignal({
    id: "signal-b",
    canonical_event_status: "duplicate",
    canonical_event_id: "signal-a",
    duplicate_of_signal_id: "signal-a",
    duplicate_match_status: "verified",
    canonical_source_name: "Publisher B",
    primary_source: "Publisher B",
  });

  const [situation] = buildSituationsV1({ signals: [canonical, duplicate] });

  assert.equal(situation.sourceIdentifierCount, 2);
  assert.equal(situation.corroboration.state, "unknown");
  assert.equal(situation.corroboration.independentOriginCount, null);
  assert.match(situation.corroboration.semantics, /source_identifier_count_is_not_independent_corroboration/);
});

test("explicit multi-source confirmation may establish corroboration without inventing probability", () => {
  const canonical = baseSignal({
    multi_source_confirmed: true,
    corroboration_count: 3,
    confidence_score: 82,
  });

  const [situation] = buildSituationsV1({ signals: [canonical] });

  assert.equal(situation.corroboration.state, "established");
  assert.equal(situation.corroboration.independentOriginCount, 3);
  assert.equal(situation.signalTrustScore, 82);
  assert.equal(situation.signalTrustSemantics, "signal_evidence_screen_not_forecast_probability");
  assert.equal(situation.forecast.probability, null);
  assert.equal(situation.forecast.state, "not_linked");
});

test("conflicting routing feedback stays conflicted", () => {
  const signal = baseSignal();
  const [situation] = buildSituationsV1({
    signals: [signal],
    feedback: [
      { signal_id: "signal-a", feedback: "confirmed", created_at: "2026-10-17T10:10:00Z" },
      { signal_id: "signal-a", feedback: "rejected", created_at: "2026-10-17T10:11:00Z" },
    ],
  });

  assert.equal(situation.review.state, "conflicted");
  assert.equal(situation.review.count, 2);
  assert.equal(situation.needsReview, true);
  assert.equal(situation.contradiction.state, "unknown_not_modeled");
});

test("operational outcome is not converted into scientific forecast resolution", () => {
  const signal = baseSignal();
  const [situation] = buildSituationsV1({
    signals: [signal],
    outcomes: [
      {
        signal_id: "signal-a",
        action_taken: true,
        outcome_success: true,
        execution_status: "completed",
      },
    ],
  });

  assert.equal(situation.operational.state, "outcome_observed");
  assert.equal(situation.operational.outcomeCount, 1);
  assert.match(situation.operational.semantics, /not_scientific_forecast_resolution/);
  assert.equal(situation.forecast.state, "not_linked");
  assert.equal(situation.forecast.probability, null);
});

test("missing evidence remains unknown rather than synthetic zero", () => {
  const signal = baseSignal({
    canonical_source_name: null,
    primary_source: null,
    affected_countries: null,
    affected_regions: null,
    confidence_score: null,
    multi_source_confirmed: null,
    corroboration_count: null,
  });

  const [situation] = buildSituationsV1({ signals: [signal] });

  assert.equal(situation.sourceIdentifierCount, 0);
  assert.equal(situation.coverage.sourceIdentity, "unknown");
  assert.equal(situation.coverage.geography, "unknown");
  assert.equal(situation.corroboration.state, "unknown");
  assert.equal(situation.signalTrustScore, null);
  assert.equal(situation.forecast.probability, null);
});

test("exact count is required before a lookback is called complete", () => {
  const complete = buildSituationWindowMetaV1({
    lookbackDays: 7,
    rowLimit: 300,
    returnedSignalRows: 121,
    totalSignalRows: 121,
    queryLatencyMs: 84,
  });
  assert.equal(complete.coverageState, "complete_window");
  assert.equal(complete.totalSignalRows, 121);

  const unknown = buildSituationWindowMetaV1({
    lookbackDays: 7,
    rowLimit: 300,
    returnedSignalRows: 121,
    totalSignalRows: null,
    queryLatencyMs: 84,
  });
  assert.equal(unknown.coverageState, "total_unknown");
  assert.equal(unknown.totalSignalRows, null);
});

test("row cap is surfaced as a sample rather than a seven-day total", () => {
  const capped = buildSituationWindowMetaV1({
    lookbackDays: 7,
    rowLimit: 300,
    returnedSignalRows: 300,
    totalSignalRows: 35000,
    queryLatencyMs: 210,
  });
  assert.equal(capped.coverageState, "capped_sample");
  assert.equal(capped.returnedSignalRows, 300);
  assert.equal(capped.totalSignalRows, 35000);

  const unknownTotal = buildSituationWindowMetaV1({
    lookbackDays: 7,
    rowLimit: 300,
    returnedSignalRows: 300,
    totalSignalRows: null,
  });
  assert.equal(unknownTotal.coverageState, "cap_reached_total_unknown");
});

test("concurrent count disagreement never becomes a false completeness claim", () => {
  const inconsistent = buildSituationWindowMetaV1({
    lookbackDays: 7,
    rowLimit: 300,
    returnedSignalRows: 300,
    totalSignalRows: 299,
  });
  assert.equal(inconsistent.coverageState, "count_inconsistent");
});

test("read failures distinguish explicit auth/RLS denial from infrastructure unavailability", () => {
  assert.equal(classifySituationReadErrorV1({ code: "42501", message: "permission denied" }), "access_denied");
  assert.equal(classifySituationReadErrorV1({ status: 403, message: "Forbidden" }), "access_denied");
  assert.equal(classifySituationReadErrorV1({ message: "connection pooler unavailable (544)" }), "unavailable");
});
