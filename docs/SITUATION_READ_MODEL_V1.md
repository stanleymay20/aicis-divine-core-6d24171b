# AICIS Situation Read Model v1

Status: controlled implementation contract  
Date: 2026-10-17  
North star: `docs/AICIS_NORTH_STAR_CONTINUATION_V1.md`

## Purpose

This document defines the first implementation slice for the AICIS `Situation` product object.

The goal is not to create a second truth store or to pretend the full Evidence Fabric is already deployed. The goal is to create a deterministic, read-only projection over existing governed records so the product can begin converging around Situations without weakening the current database, migration or evidence boundaries.

The v1 loop is:

```text
global_signals
  -> canonical / duplicate identity handling
  -> Situation read model
  -> evidence / missingness state
  -> analyst routing-feedback state
  -> linked operational decision / outcome state
```

This is Phase B of the continuation sequence. It is deliberately smaller than the long-term Situation architecture.

## Source-of-truth boundaries

Situation v1 reads existing records. It does not write or mutate:

- `global_signals`;
- forecasting ledgers;
- Evidence Fabric candidate tables;
- decision records;
- outcome records;
- RLS / auth policies;
- Supabase schema.

No migration is introduced by this slice.

The authoritative underlying records remain the existing source tables. The Situation is a product read model, not a replacement record of truth.

## Inputs

### Signal identity and evidence

Primary input: `global_signals`.

The projection may use only fields that are already part of the maintained live application contract, including signal identity, title / summary, category, canonical-event state, duplicate identity, source identity, source trust screen, impact / urgency screen, affected geography / sectors / stakeholders, timestamps and enrichment state.

### Analyst / routing review

`signal_routing_feedback` is used only as an existing review signal. Multiple records may disagree. A conflict must be surfaced rather than collapsed.

### Operational decision / outcome state

`decision_outcome_log` may be linked by `signal_id` to show whether an operational action / outcome record exists.

This does **not** automatically prove that the record represents an authorized human decision, a scientifically resolved event, or a forecast resolution. The UI must label it as operational decision / outcome state unless stronger governed evidence is available.

## Canonical identity rules

Situation v1 must not collapse reports merely because their titles look similar.

1. A canonical signal forms its own Situation identity.
2. A duplicate report may join a canonical Situation only when the existing record marks it as a verified duplicate and provides a canonical target.
3. Candidate / unverified duplicate relationships remain separate Situations.
4. Missing canonical identity remains explicit; the source signal ID becomes the stable read-model key.
5. The projection must never invent cross-source event identity from source count, title similarity or geography alone.

## Evidence rules

### Source identifiers are not independent corroboration

A Situation may count distinct source identifiers for descriptive coverage.

That count must never be presented as independent-source corroboration.

### Corroboration

Independent corroboration is only shown as established when the existing signal record explicitly reports multi-source confirmation with a non-null corroboration count consistent with that state.

Otherwise the read model returns `unknown` or `not_established`; it must not infer independence from two URLs, two publishers, two rows or two source identifiers.

### Contradictions

The current v1 source set does not provide a complete governed source-claim contradiction graph.

Therefore source contradiction state is **unknown / not modeled** in Situation v1.

Routing-feedback disagreement may be shown separately as `review_conflict`; it is not equivalent to contradictory external evidence.

### Confidence

Existing `confidence_score` on `global_signals` is not automatically a calibrated probability.

Situation v1 may display it only as a signal trust / evidence screen and must label it `not a forecast probability`.

### Missingness

Missing fields stay missing.

The read model must not convert unknown values into 0, 50%, "safe", "healthy" or another synthetic default.

## Review-state rules

Routing feedback is reduced deterministically:

- no feedback -> `unreviewed`;
- only `confirmed` -> `confirmed`;
- only `rejected` -> `rejected`;
- only `unclear` -> `unclear`;
- both confirmed and rejected -> `conflicted`;
- mixed values that do not include both confirmed and rejected -> latest valid record, while retaining the full feedback count.

## Operational outcome rules

Linked `decision_outcome_log` records are summarized without overstating authority:

- none -> `not_recorded`;
- record exists, no action -> `recorded`;
- action recorded, no measured outcome -> `action_recorded`;
- an explicit non-null `outcome_success` exists -> `outcome_observed`.

`outcome_observed` is an operational outcome state. It is not automatically a scientific forecast resolution.

## Forecast boundary

Situation v1 intentionally does not attach an official forecast.

The forecast state is `not_linked` until a registered, sealed forecast can be joined without bypassing `docs/AICIS_SCIENTIFIC_FORECASTING_PROTOCOL_V1.md` and the forecast-ledger deployment gates.

Do not reuse an arbitrary model score as a Situation forecast probability.

## Runtime coverage and access truth

The Situation workspace uses a configured lookback and row cap. Those settings describe a query boundary; they do not by themselves prove that every row in the lookback was loaded.

1. The row read and an exact, read-only count query are independent. A failure of the exact count must not hide otherwise readable signal rows.
2. The UI may call the lookback `complete_window` only when the exact count equals the number of loaded signal rows.
3. If the exact count is greater than the loaded row count, the page must label the result `capped_sample` and make clear that queue counts and filters describe only the loaded sample.
4. If the exact count is unavailable, completeness remains unknown. Reaching the configured row cap must be labeled `cap_reached_total_unknown`, not a complete lookback.
5. If the count and row reads disagree in the opposite direction during concurrent ingestion, the state is `count_inconsistent`; the UI must not claim completeness.
6. Authentication / RLS denial must be distinguished from ordinary read unavailability. A denied or failed read must never be interpreted as an empty table or as proof that no feedback / outcome record exists.
7. Client-observed read-batch latency may be displayed for runtime diagnostics, but it must be labeled as client-observed latency rather than database execution time.

These rules preserve the v1 truth floor while giving issue #48 reproducible row-volume, coverage and access-state evidence without introducing persistence or weakening RLS.

## UI behavior

The first Situation page should make the truth boundary visible:

- canonical situation identity;
- source identifiers and report count;
- independent corroboration state;
- source contradiction state (`not modeled / unknown` in v1);
- affected geography / sectors / stakeholders;
- signal trust screen with non-probability label;
- review status and review conflicts;
- linked operational action / outcome state;
- forecast state (`not linked` until governed forecasts exist);
- configured lookback coverage state and loaded-vs-total row count when known;
- read-batch latency with its client-observed semantics;
- distinct access states for exact count, identity, routing feedback and operational outcomes.

The page should prioritize Situations that need review rather than reward high feature count.

## Non-goals

Situation v1 does not:

- deploy the Evidence Fabric candidate schema;
- migrate PR #31 forecast ledgers;
- claim complete provenance lineage;
- create a source-claim contradiction graph;
- create a new operational action engine;
- auto-execute decisions;
- claim calibrated forecasting;
- claim that `decision_outcome_log` is external ground truth;
- replace existing World, Signal Validation, Decisions or Forecast pages.

## Verification requirements

Before merge:

1. deterministic unit tests must cover canonical duplicate grouping;
2. unverified duplicate candidates must remain separate;
3. source identifier count must not become corroboration;
4. missing corroboration must stay unknown;
5. conflicting review feedback must remain conflicted;
6. operational outcomes must remain distinct from forecast resolution;
7. row-cap coverage must never be reported as complete unless exact-count evidence proves it;
8. auth/RLS denial must remain distinct from generic infrastructure unavailability and from an empty result;
9. route / workspace ownership must be deterministic;
10. exact-head CI, CodeQL, authentication boundary proof and DB behavioral proof must pass.

## Next controlled step after v1

After the read model proves useful against real records, evaluate a separately reviewed Situation persistence candidate that can bind immutable Evidence Fabric artifacts, governed knowledge-time semantics, entity / asset relationships, human disposition and later resolution evidence.

That persistence step must not occur merely because the UI exists. It requires a schema / RLS / migration design and non-production behavioral validation.
