# AICIS Scientific Forecasting Protocol v1

Status: controlled scientific protocol candidate  
Protocol identifier: `aicis-scientific-forecasting-protocol-v1`

## 1. Purpose

AICIS must earn predictive claims through evidence. This protocol defines the minimum scientific contract a forecasting task must satisfy before AICIS may treat outputs as registered forecasts, compare models, calibrate probabilities, promote an operational model, or use resolved predictions as scientific performance evidence.

The protocol does **not** claim that AICIS already predicts the world, establishes causality, or has achieved breakthrough status. It establishes the rules by which those claims can later be tested.

## 2. Non-negotiable principles

1. **Future means future.** A forecast may use only information genuinely knowable at its forecast origin.
2. **Unknown stays unknown.** Missing evidence, lineage, coverage or calibration cannot become zeros, neutral scores or synthetic confidence.
3. **Forecast targets are explicit.** There is no universal AICIS “accuracy” or generic “risk” outcome.
4. **Simple baselines are mandatory.** Complex models must demonstrate skill against task-appropriate naive/statistical baselines.
5. **Probabilities are scored as probabilities.** Proper probabilistic scores are primary where probabilities/distributions are claimed.
6. **Calibration is empirical.** A model-emitted number is not calibrated merely because it lies in `[0,1]`.
7. **Forecasts are immutable after sealing.** A prediction cannot be rewritten after target-period evidence becomes admissible.
8. **Prospective evidence outranks retrospective elegance.** Operational promotion requires sealed forecasts made before the future occurred.
9. **Prediction is not causality.** Association, temporal precedence and graph propagation do not establish an intervention effect.
10. **Abstention is required.** AICIS must refuse scientific forecasts when the evidence contract is not met.

## 3. Temporal truth contract

Every scientific evidence item must ultimately be interpretable using these temporal concepts:

- `valid_time` / `event_time` — when the underlying state or event occurred;
- `published_time` — when a provider/source made it public;
- `knowledge_time` — earliest governed time at which AICIS could legitimately know it;
- `ingested_at` / system time — when AICIS actually received/stored it;
- `revision_time` / data vintage — when a provider corrected, restated or backfilled it.

For historical evaluation, feature eligibility is bounded by:

`knowledge_time <= forecast_origin`

Event time alone is insufficient. The existing `verified_leakage_safe` knowledge-time proof remains the historical admission truth floor. A legacy `is_leakage_safe` boolean, snapshot date, freshness field or caller assertion cannot substitute for governed proof.

## 4. Forecast Task Registry contract

Every scientific forecasting problem must be registered before model comparison. A task must define:

- exact protocol version;
- stable task ID and semantic task version;
- domain and geography level;
- target type and exact outcome definition;
- target outcome field;
- forecast horizon;
- knowledge-time policy;
- resolution authority, authority class and revision policy;
- mandatory baseline suite;
- primary and secondary metrics;
- rolling-origin evaluation policy;
- calibration policy and claim threshold;
- abstention policy;
- model promotion policy;
- immutable ledger requirements;
- claim semantics.

The executable validator is `scripts/scientific-forecasting-protocol-v1.mjs`.

## 5. Supported target families

### Binary

Examples: material conflict escalation within 30 days; route closure within 7 days.

Approved primary probabilistic scores: **Brier** or **log loss**. Mandatory baselines: **base rate** and **persistence**. PR-AUC and other class-imbalance diagnostics may be secondary; classification accuracy is not an approved primary scientific score.

### Count

Examples: violent-event counts, fatalities, port-disruption events.

Approved primary probabilistic scores: **CRPS** or **log score**. Mandatory baselines: **historical rate** and **persistence**.

### Continuous

Examples: energy price, shipping delay, storage level.

Approved primary probabilistic scores: **CRPS** or **log score**. Mandatory baselines: **persistence** and **seasonal naive**. Point-error metrics may be secondary but do not replace distributional evaluation when a probabilistic forecast is claimed.

### Time-to-event

Examples: time until next severe disruption.

Approved primary scores: **log score** or **negative log likelihood**. Mandatory baseline: **historical intensity**.

### Event sequence

Examples: a future sequence of conflict or disruption events.

Approved primary probabilistic scores: **log score** or **negative log likelihood**. Long-horizon event metrics may be secondary diagnostics, but protocol v1 does not treat an arbitrary long-horizon event metric as a proper primary probability score. Mandatory baseline: **historical intensity**.

### Temporal graph link

Examples: probability that a registered actor-relation-actor edge appears during a future window.

Approved primary probability scores: **Brier** or **log loss**. Ranking diagnostics such as MRR/Hits@k may be secondary. Mandatory baselines: **recurrence** and **historical frequency**.

### Ranking

Examples: an ordered country list under a precisely defined future outcome.

A ranking task still requires resolvable future outcomes and may not be justified by arbitrary internally generated risk scores. Mandatory baselines: **prior rank** and **frequency**.

## 6. Ground truth and resolution

A forecast cannot resolve itself. Every task must declare an external or independently governed resolution authority in one of these classes:

- official statistics;
- governed event dataset;
- primary source;
- independently adjudicated outcome;
- registered operational outcome.

A task must also declare one data-vintage policy:

- `first_release`;
- `latest_available`;
- `final_vintage`;
- `versioned_as_of_resolution`.

The resolved outcome, source/version, resolution timestamp and evidence digest must be retained. A model score, heuristic score, LLM judgement, previous AICIS forecast or synthetic label is not ground truth unless a separate governed adjudication protocol explicitly establishes it.

## 7. Evaluation hierarchy

Every registered task must support both of the following modes.

### 7.1 Retrospective rolling-origin evaluation

Repeated historical forecast origins are used. At each origin `T`, only evidence whose governed knowledge time is no later than `T` is eligible. Random train/test splitting is not acceptable for temporal scientific claims.

Hyperparameter/model selection must not inspect the final future test period. The final test evidence is used only after candidate selection for that evaluation origin.

Protocol v1 requires at least three forecast origins as an absolute floor. Serious task-specific studies should use substantially more whenever historical depth permits.

### 7.2 Sealed prospective evaluation

A registered task must support `prospective_sealed`: predictions are generated against the genuinely unresolved future, bound to the exact evidence/model/code manifests, and sealed before target-period evidence becomes admissible to that prediction.

A model may operate in a **shadow deployment state** during this prospective phase, meaning its forecast has no operational authority. Shadow status does **not** replace prospective sealing and does not convert retrospective experiments into future evidence.

AICIS must separately label:

- retrospective results;
- prospective shadow results;
- prospective operational results.

These populations must not be pooled into one headline score without explicit stratification.

## 8. Baseline tournament

No advanced model receives credit merely because it is complex. Candidate models compete against mandatory baselines and the current champion using identical forecast origins, target definitions and evidence cutoffs.

Future challengers may include regularized logistic regression, Poisson/negative-binomial models, gradient-boosted trees, Hawkes/spatiotemporal point processes, temporal forecasting models, temporal knowledge graphs, graph neural networks, time-series foundation models and cross-domain world-state models.

The existing AICIS trained logistic model is a tournament baseline/challenger family, not proof of a general world model.

## 9. Calibration

Raw model probability and calibrated probability are separate scientific objects.

Calibration may use isotonic, logistic/Platt or another governed method, but calibration fitting may use only appropriate **resolved** forecasts. Unresolved future outcomes and held-out final-test evidence may not leak into calibration fitting.

Protocol v1 sets **100 resolved forecasts as an absolute minimum before a task may make a scientific calibration claim**. This is only a floor, not evidence that 100 observations are adequate for a rare event, subgroup, geography or high-stakes claim. Task-specific protocols should require larger samples where necessary.

Calibration evidence must report sample size, period, domain/horizon scope, method/version and reliability diagnostics.

## 10. Abstention

Scientific tasks must enable abstention. Protocol v1 requires at least these triggers:

- `knowledge_time_unverified`;
- `source_coverage_insufficient`;
- `calibration_insufficient`;
- `severe_distribution_shift`;
- `excessive_model_disagreement`.

Tasks may add ground-truth outages, unseen regimes, missing core features, inadequate reporting maturity or coherence failures.

Abstention must never be rendered as 0%, 50%, “low risk”, “healthy”, “safe” or another manufactured certainty.

## 11. Immutable Forecast Ledger

Every prospective registered forecast must be frozen against its evidence cutoff before target-period evidence becomes admissible to the forecast, and it becomes immutable after sealing.

Protocol-v1 task registration therefore requires `seal_before_target_period_evidence: true`.

At minimum the sealed evidence package must bind:

- `data_manifest_hash`;
- `feature_manifest_hash`;
- `model_artifact_hash`;
- `git_commit_sha`.

The future ledger must additionally preserve task/version, forecast origin, knowledge cutoff, target window, entity/geography, model/ensemble/calibration versions, forecast distribution, generation time and seal time.

A later update creates a **new forecast**. It never edits an existing sealed prediction.

## 12. Model promotion

Protocol v1 forbids automatic operational promotion.

Before operational use, a challenger must:

1. satisfy the task contract;
2. show positive skill against mandatory baselines;
3. pass knowledge-time-bounded rolling-origin evaluation;
4. pass task-specific calibration and abstention gates;
5. issue sealed prospective forecasts (shadow deployment may be used, but does not replace prospective evidence);
6. accumulate the task’s minimum resolved prospective sample;
7. pass explicit promotion review.

Protocol v1 sets **100 resolved prospective forecasts as the absolute minimum before operational promotion may be considered**. This is a floor; tasks may and usually should require more.

Promotion is not permanent proof of superiority. Drift or prospective degradation may trigger recalibration, challenger training or retirement.

## 13. Observation and reporting process

AICIS must not assume “not observed” means “did not happen”. Future observation-aware tasks should explicitly model reporting delay, source density, language coverage, geographic coverage, revision/backfill behaviour and reporting maturity.

Observation-model outputs are uncertainty evidence. They must not fabricate unobserved events as ground truth.

## 14. Ensembles and coherence

Once multiple validated models exist, AICIS may compare equal-weight and learned ensembles. Learned weights may be fit only on resolved forecast evidence and must themselves be versioned/evaluated.

Hierarchical/cross-temporal reconciliation should be used where quantities are mathematically aggregable. Probabilities must not be naively summed across countries or periods without a defined joint-event model.

## 15. Drift

Operational models should eventually monitor:

- feature-distribution drift;
- source/reporting-process drift;
- prediction-distribution drift;
- residual/performance drift;
- calibration drift;
- missingness/coverage drift.

Drift detection does not authorize blind automatic retraining. It creates evidence for a challenger/recalibration workflow.

## 16. LLM boundary

LLMs may support entity/event extraction, governed classification, evidence summarization, retrieval, hypothesis generation, scenario narration, translation and explanation of quantitative forecasts.

An unconstrained LLM probability is not automatically an official AICIS calibrated probability.

## 17. Causality boundary

Protocol-v1 tasks must declare:

`predictive_not_causal_without_identification`

AICIS may report predictive dependency, temporal association or propagation evidence, but cannot convert those into an intervention-effect claim.

A future causal protocol must specify identification assumptions, confounder handling, intervention definition, falsification/sensitivity tests and the evidentiary status of each effect.

## 18. Breakthrough claim gate

AICIS must not describe itself as a validated world-prediction breakthrough merely because this architecture exists.

A stronger claim requires prospective evidence showing, at minimum:

- consistent skill versus strong simple baselines;
- probability calibration;
- performance across multiple future periods and geographies;
- cross-domain incremental value where claimed;
- observation/reporting-process awareness;
- reproducibility from immutable manifests;
- disciplined abstention;
- independent or externally reviewable evaluation;
- evidence that predictive gains matter operationally.

## 19. Controlled implementation sequence

1. World-model data foundation merged only after review/CI. **Completed: PR #18.**
2. Adopt this Scientific Forecasting Protocol v1 plus executable validation gate.
3. Implement Forecast Task Registry v1.
4. Implement immutable Forecast Ledger and Resolution Ledger.
5. Implement knowledge-time-bounded rolling-origin evaluation.
6. Run the historical source asset audit once source access is available.
7. Register baseline tournaments.
8. Register the first flagship task only after its exact conflict/geopolitical ground-truth rule is approved.
9. Run retrospective rolling-origin evidence.
10. Begin **sealed prospective forecasting**, initially with no operational authority.
11. Add energy/logistics tasks.
12. Test cross-domain incremental predictive skill.
13. Develop shared latent world-state representations only after lower-level forecasting evidence justifies them.
14. Develop causal/intervention methods only under a separate causal-evidence protocol.

## 20. Change control

This protocol is versioned. Weakening a truth, leakage, evaluation, calibration, baseline, ledger, abstention or promotion requirement requires a new protocol version and explicit review. Existing forecasts remain bound to the protocol version under which they were issued.
