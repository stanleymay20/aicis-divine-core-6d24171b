# AICIS Scientific Forecasting Protocol v1

Status: controlled scientific protocol candidate

Protocol identifier: `aicis-scientific-forecasting-protocol-v1`

## 1. Purpose

AICIS must earn predictive claims through evidence. This protocol defines the minimum scientific contract that a forecasting task must satisfy before AICIS may treat outputs as registered forecasts, compare models, calibrate probabilities, promote an operational model, or use resolved predictions as scientific performance evidence.

The protocol does **not** claim that AICIS already predicts the world, establishes causality, or has achieved scientific breakthrough status. It establishes the rules by which those claims could later be tested.

## 2. Governing principles

1. **Future means future.** A forecast may use only information that was genuinely knowable at its forecast origin.
2. **Unknown stays unknown.** Missing evidence, unresolved lineage, missing source coverage, or inadequate calibration must not be converted into zeros, neutral scores, or synthetic confidence.
3. **Forecast targets are explicit.** There is no universal AICIS “accuracy” or generic “risk” target. Each task has a versioned outcome definition, horizon, geography and resolution authority.
4. **Simple baselines are mandatory.** Complex models must demonstrate skill against task-appropriate naive or statistical baselines.
5. **Probabilities must be scored as probabilities.** Binary probability forecasts use proper scoring rules such as Brier or log loss; other target types use task-appropriate probabilistic scores.
6. **Calibration is empirical.** A numeric probability is not called calibrated merely because a model produced it.
7. **Predictions are immutable after sealing.** Forecasts cannot be rewritten after target-period information becomes available.
8. **Prospective evidence outranks retrospective elegance.** Operational promotion requires evidence from predictions sealed before the future occurred.
9. **Prediction is not causality.** Predictive association, temporal precedence and graph propagation do not establish an intervention effect.
10. **Abstention is required.** AICIS must refuse to issue a scientific forecast when the evidence contract is not met.

## 3. Temporal truth contract

Every scientific feature or evidence item must ultimately be interpretable using the following temporal concepts:

- `valid_time` / `event_time`: when the underlying state or event occurred;
- `published_time`: when a provider or source made the information available;
- `knowledge_time`: earliest governed time at which AICIS could legitimately know the information;
- `ingested_at` / system time: when AICIS actually received or stored the information;
- `revision_time` / data vintage: when a provider corrected, restated or backfilled the record.

For historical evaluation, feature eligibility is bounded by `knowledge_time <= forecast_origin`. Event time alone is insufficient.

The existing AICIS `verified_leakage_safe` knowledge-time proof remains the admission truth floor for historical training rows. A legacy `is_leakage_safe` boolean, a snapshot date, freshness field, or caller assertion cannot substitute for governed proof.

## 4. Forecast Task Registry contract

Every scientific forecasting problem must be registered before model comparison. A task must define at least:

- protocol version;
- stable task ID and semantic task version;
- domain and geography level;
- target type;
- exact outcome definition and outcome field;
- forecast horizon;
- knowledge-time policy;
- resolution authority and authority class;
- data revision policy;
- mandatory baseline suite;
- primary and secondary metrics;
- rolling-origin evaluation policy;
- calibration policy and claim threshold;
- abstention policy;
- model promotion policy;
- immutable forecast-ledger requirements;
- claim semantics.

The executable validator is `scripts/scientific-forecasting-protocol-v1.mjs`.

## 5. Supported target families

### Binary

Examples: material conflict escalation within 30 days; route closure within 7 days.

Primary approved probabilistic scores: Brier score or log loss.

Mandatory initial baselines: base rate and persistence.

Class-imbalance diagnostics such as PR-AUC may be reported as secondary metrics, but classification accuracy is not an approved primary scientific score.

### Count

Examples: violent-event count, fatalities, port disruption events.

Primary approved probabilistic scores: CRPS or log score.

Mandatory initial baselines: historical rate and persistence.

### Continuous

Examples: energy price, shipping delay, storage level.

Primary approved probabilistic scores: CRPS or log score. Point-error measures may be secondary but do not replace distributional evaluation when a probabilistic forecast is claimed.

Mandatory initial baselines: persistence and seasonal naive.

### Time-to-event and event sequence

Examples: time until next severe disruption; future sequence of conflict events.

Primary approved scores include log score, negative log likelihood, or a governed long-horizon event score.

Mandatory initial baseline: historical intensity.

### Temporal graph link

Examples: probability that a registered actor-relation-actor edge appears during a future window.

Primary probability score: Brier or log loss. Ranking diagnostics such as MRR/Hits@k may be secondary.

Mandatory baselines: recurrence and historical frequency.

### Ranking

Examples: ordered country risk under a precisely defined future outcome.

A ranking task must still have a resolvable future outcome and cannot be justified by arbitrary internally generated risk scores.

Mandatory baselines: prior rank and frequency.

## 6. Ground-truth and resolution policy

A forecast cannot resolve itself.

Every task must declare an external or independently governed outcome authority belonging to an approved class:

- official statistics;
- governed event dataset;
- primary source;
- independently adjudicated outcome;
- registered operational outcome.

A task must also declare how revisions are handled:

- first release;
- latest available;
- final vintage;
- versioned as of resolution.

The resolved outcome, source/version, resolution timestamp and evidence digest must be retained. A model score, heuristic score, LLM judgement, previous AICIS forecast or synthetic label is not ground truth unless a separate, governed adjudication protocol explicitly makes it so.

## 7. Evaluation hierarchy

A scientific task must support two evaluation modes from inception:

### 7.1 Retrospective rolling-origin evaluation

Repeated historical forecast origins are used. For each origin `T`, only evidence whose governed knowledge time is no later than `T` is eligible.

Random train/test splitting is not acceptable for temporal scientific claims.

Model/hyperparameter selection must not inspect the final future test period. Test data is used only after model selection for that evaluation origin.

The protocol requires at least three forecast origins; serious task-specific studies should use substantially more whenever the historical depth permits it.

### 7.2 Shadow or prospective evaluation

A candidate issues predictions against the real future while having no authority to rewrite them. Operational promotion requires prospective evidence.

AICIS must distinguish:

- retrospective result;
- shadow prospective result;
- operational prospective result.

They must never be pooled into a single performance number without explicit stratification.

## 8. Baseline tournament

No advanced model receives credit merely because it is complex.

Each task has mandatory baselines appropriate to the target. Candidate models compete against those baselines and against the current champion using identical forecast origins, target definitions and evidence cutoffs.

Examples of future challengers include:

- regularized logistic regression;
- Poisson / negative-binomial models;
- gradient-boosted trees;
- Hawkes / spatiotemporal point-process models;
- temporal forecasting models;
- temporal knowledge-graph models;
- graph neural networks;
- time-series foundation models;
- cross-domain world-state models.

The existing AICIS trained logistic model should be treated as a tournament baseline/challenger family, not as proof of a general world model.

## 9. Calibration

Model probabilities and calibrated probabilities are separate scientific objects.

Calibration may use methods such as isotonic, logistic/Platt or other governed methods, but calibration data must consist only of resolved historical forecasts appropriate to the calibration design. Unresolved future outcomes and held-out final test evidence cannot leak into fitting.

Protocol v1 sets **100 resolved forecasts as the absolute minimum before an AICIS task may make a scientific calibration claim**. This is a floor, not a guarantee of adequacy. High-stakes, rare-event and subgroup claims will generally require larger samples and stratified reliability evidence.

Calibration reports should include sample size, period, domain/horizon scope, reliability diagnostics and the calibration method/version.

## 10. Abstention

A scientific task must define and enable abstention. Protocol v1 requires at least these triggers:

- historical knowledge time is unverified;
- source coverage is insufficient;
- calibration evidence is insufficient for the requested claim;
- severe distribution shift is detected;
- model disagreement is excessive under the task policy.

Additional task-specific triggers may include ground-truth outages, unrecognized regimes, missing required features, reporting maturity below threshold, or forecast-coherence failure.

Abstention must not be rendered as 0%, 50%, “low risk”, healthy, safe, or any other manufactured certainty.

## 11. Immutable Forecast Ledger

Every registered forecast must be sealed before its resolution window opens and become immutable after sealing.

At minimum the forecast evidence package must bind:

- `data_manifest_hash`;
- `feature_manifest_hash`;
- `model_artifact_hash`;
- `git_commit_sha`.

The future ledger implementation must also preserve task/version, forecast origin, knowledge cutoff, target window, entity/geography, model/ensemble/calibration versions, forecast distribution, generation time and seal time.

A later update creates a **new forecast**, never edits the old sealed prediction.

## 12. Model promotion

Protocol v1 forbids automatic operational promotion.

Before operational use, a challenger must:

1. satisfy the task contract;
2. show positive skill against mandatory baselines;
3. pass retrospective rolling-origin evaluation;
4. pass task-specific calibration and abstention gates;
5. issue sealed shadow/prospective forecasts;
6. accumulate the task's minimum resolved prospective sample;
7. pass explicit promotion review.

Protocol v1 establishes **100 resolved forecasts as the absolute minimum sample before operational promotion may be considered**. A task may and usually should require more.

Promotion is not a declaration of permanent superiority. Drift or prospective degradation may trigger recalibration, challenger training or retirement.

## 13. Observation and reporting process

AICIS must not assume that “not observed” means “did not happen”. Future observation-aware tasks should explicitly model reporting delay, source density, language coverage, geographic coverage, revision/backfill behaviour and reporting maturity.

Observation-model outputs are uncertainty evidence. They must not silently fabricate unobserved events as ground truth.

## 14. Ensembles and coherence

Once multiple validated models exist, AICIS may compare equal-weight and learned ensembles. Learned weights must be trained only on resolved forecasts and must themselves be versioned and evaluated.

Hierarchical/cross-temporal reconciliation should be used where forecast quantities are mathematically aggregable. Probabilities must not be naively summed across countries or periods without a defined joint-event model.

## 15. Drift

Every operational model should eventually monitor:

- feature distribution drift;
- source/reporting-process drift;
- prediction distribution drift;
- residual/performance drift;
- calibration drift;
- missingness/coverage drift.

Drift detection does not authorize blind automatic retraining. It creates evidence for a challenger/recalibration workflow.

## 16. LLM role

LLMs may support:

- entity/event extraction;
- classification under governed schemas;
- evidence summarization;
- retrieval;
- hypothesis generation;
- scenario narration;
- translation;
- explanation of quantitative forecasts.

An unconstrained LLM probability is not automatically an official AICIS calibrated probability.

## 17. Causality boundary

Protocol-v1 forecast tasks must declare:

`predictive_not_causal_without_identification`

This means AICIS may report predictive dependency, temporal association or propagation evidence, but cannot convert them into a causal intervention claim.

A future causal protocol must specify identification assumptions, confounder handling, intervention definition, falsification/sensitivity tests and the evidentiary status of each effect.

## 18. Breakthrough claim gate

AICIS must not describe the scientific system as a validated world-prediction breakthrough merely because this architecture exists.

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

1. Merge the world-model data foundation only after all review and CI gates pass. **Completed by PR #18.**
2. Adopt this Scientific Forecasting Protocol v1 and its executable validation gate.
3. Implement Forecast Task Registry v1.
4. Implement immutable Forecast Ledger and Resolution Ledger.
5. Implement knowledge-time-bounded rolling-origin evaluation.
6. Run the historical source asset audit once source access is available.
7. Register baseline tournaments.
8. Register the first flagship task, initially targeting conflict/geopolitical escalation only after its exact ground-truth rule is approved.
9. Run retrospective rolling-origin evidence.
10. Begin sealed shadow prospective forecasting.
11. Add energy/logistics tasks.
12. Test cross-domain incremental predictive skill.
13. Develop shared latent world-state representations only after lower-level forecasting evidence justifies them.
14. Develop causal/intervention methods only under a separate causal evidence protocol.

## 20. Change control

This protocol is versioned. Weakening any truth, leakage, evaluation, calibration, baseline, ledger, abstention or promotion requirement requires a new protocol version and explicit review. Existing forecasts remain bound to the protocol version under which they were issued.
