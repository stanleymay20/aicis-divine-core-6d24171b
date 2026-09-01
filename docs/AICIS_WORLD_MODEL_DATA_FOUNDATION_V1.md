# AICIS World Model — Data Foundation v1

## Objective

Turn AICIS's accumulated longitudinal intelligence into scientifically auditable training data for temporal, cross-domain and forecasting models without teaching new models to reproduce legacy heuristic scores.

This phase does **not** train or promote a production model. It establishes the evidence boundary that must exist first.

## Existing assets we will reuse

AICIS already contains the important primitives:

- `global_signals` — accumulated global signal/evidence rows.
- `normalized_events` — normalized event evidence.
- `normalized_metrics` — country/domain metric observations.
- `training_dataset_aicis` — country × domain × date state-transition candidates.
- `predictive_forecasts` — forecast records.
- `forecast_ground_truth` — realized forecast outcomes.
- `forecast_validation_events` — supporting validation evidence.
- `strategic_causal_links` — derived causal/propagation candidates.
- `ml_training_rows_knowledge_time_eligible_v3` — fail-closed leakage-safe training surface.
- immutable ML training manifests/run audit structures.

## Scientific truth floor

A row is not admissible merely because it is old or has a historical date.

Training admission requires:

1. a historical observation/cutoff;
2. an outcome strictly after that cutoff/horizon;
3. explicit record-level provenance;
4. a real ground-truth label rather than a model/heuristic score;
5. verified evidence status;
6. `knowledge_time_status = verified_leakage_safe`;
7. a versioned knowledge-time proof and SHA-256 digest;
8. no synthetic candidate or provenance-free backfill.

Unknown, legacy and unverified evidence remains excluded. No zero/default value may be manufactured to make a row trainable.

## Two first-class training example types

### 1. State transition

Use `training_dataset_aicis` to learn:

```text
country/domain state at T0
        ↓
observed state at T0 + horizon
```

Example targets can include observed deterioration or future metric state, provided the target is truly post-cutoff and knowledge-time proof exists for every feature.

### 2. Forecast outcome

Use forecast + ground-truth pairs to learn calibration and event progression:

```text
signal state
   ↓
forecast generated
   ↓
forecast horizon closes
   ↓
real-world outcome observed
```

Legacy forecast probabilities are evidence about prior model behaviour, not ground-truth labels.

## Phase 1 deliverables in this branch

- `scripts/world-model-training-contract.mjs`
  - executable fail-closed admission contract;
  - supports state-transition and forecast-outcome examples;
  - requires knowledge-time proof;
  - rejects synthetic/derived labels and temporal leakage.

- `tests/world-model-training-contract.test.mjs`
  - tests positive and negative admission cases.

- `scripts/sql/aicis-historical-training-asset-audit-v1.sql`
  - read-only source-database audit;
  - reports temporal coverage, domain/country breadth, labeling, knowledge-time eligibility, forecast-ground-truth pairing and immutable manifests.

- `.github/workflows/ci.yml`
  - world-model admission contract is a required CI gate.

## Source data preservation gate

Before the historical/source AICIS database can be retired or overwritten, collect and retain at minimum:

- table-level row counts;
- earliest/latest timestamps;
- country/domain coverage;
- exact counts of labeled vs unlabeled rows;
- knowledge-time eligibility counts;
- forecast-to-ground-truth pairing counts;
- immutable manifest counts;
- checksums or equivalent content manifests for critical historical assets;
- documented source → target reconciliation.

The new `aicis-production` target must not be assumed to contain this history until parity is demonstrated.

## Model development sequence after source audit

1. **Baseline state-transition model**
   - simple, interpretable baseline first;
   - chronological train/validation/test only;
   - compare against naive persistence/base-rate baselines.

2. **Forecast calibration model**
   - evaluate historic forecast probabilities against realized outcomes;
   - Brier score and reliability/calibration analysis.

3. **Temporal sequence model**
   - learn country/domain trajectories across days/weeks;
   - no random row split.

4. **Cross-domain propagation model**
   - model relationships such as energy → economy → supply chain → social/political effects;
   - derived causal links are hypotheses/features, never treated as causal truth without validation.

5. **Weak-signal early-warning model**
   - evaluate which precursor patterns precede later validated events.

6. **Historical analogy / retrieval layer**
   - semantic/structured retrieval across previous trajectories;
   - vector search may be added later, but embeddings are retrieval features, not outcome truth.

## Release gates for any future model

A model cannot be called production-ready unless all of the following are demonstrated on held-out chronological evidence:

- reproducible immutable training manifest;
- zero unverified knowledge-time rows in the training manifest;
- non-empty validation and test periods;
- benchmark against simple baselines;
- calibration metrics for probabilistic outputs;
- domain/country slice performance;
- documented failure modes and abstention rules;
- model/data version provenance;
- no live auto-intervention path enabled merely because a model exists.

## Immediate blocker

The connected Supabase account can see the new `aicis-production` project, but the historical source AICIS project is not currently accessible through the connector. Therefore this branch intentionally stops short of claiming historical row counts or training a model.

Once source access is available, run `scripts/sql/aicis-historical-training-asset-audit-v1.sql`, review the evidence, and build the first baseline only from admitted rows.
