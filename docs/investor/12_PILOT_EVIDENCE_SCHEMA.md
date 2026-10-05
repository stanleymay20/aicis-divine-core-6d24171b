# AICIS Pilot Evidence Schema

## Purpose

This schema defines the minimum evidence AICIS must collect before making effectiveness claims from a historical replay, shadow-mode evaluation or controlled pilot.

A demo is not a pilot. A pilot is not validation unless the baseline, scope, metrics and failures are recorded.

## 1. Evaluation identity

Every evaluation must record:

- evaluation ID;
- organization/design partner;
- workflow/use case;
- evaluation mode: historical replay / shadow / sandbox;
- start and end date;
- geography/business unit;
- participating roles;
- AICIS commit/release/version;
- data-source inventory version;
- evaluation protocol version;
- approver(s).

## 2. Intended question

Write one falsifiable question before running the evaluation.

Example structure:

> In [defined workflow], does AICIS improve [defined metric] relative to [defined baseline] during [defined evaluation window], while preserving [defined provenance/human-review requirement] and without exceeding [defined failure threshold]?

Avoid questions such as "Does AICIS work?"

## 3. Baseline record

Record the existing workflow before AICIS is introduced:

- information sources;
- number/type of tools;
- analyst/operator steps;
- typical triage time where measurable;
- escalation criteria;
- documentation/provenance practice;
- known alert volume;
- known false-positive/false-negative burden if measurable;
- staffing assumptions;
- business-hours/out-of-hours behavior.

If the baseline cannot be measured, state that explicitly and downgrade any comparative claim.

## 4. Source/provenance metrics

For the evaluation corpus calculate where applicable:

```text
Source coverage = items with attributable source / total evaluated items

Timestamp coverage = items with usable event/publish timestamp / total evaluated items

Traceable assessment rate = assessments whose material claims can be traced to recorded evidence / total assessments
```

Also record:

- broken/unavailable sources;
- stale sources;
- conflicting sources;
- unlicensed/unusable sources removed from evaluation;
- source classes overrepresented/underrepresented.

## 5. Canonicalization / duplication

Where multiple feeds describe the same event, record:

- raw item count;
- candidate duplicate count;
- correctly merged duplicates;
- incorrect merges;
- missed merges;
- provenance retained after merge.

Never optimize duplicate reduction at the expense of losing materially different evidence.

## 6. Detection / classification performance

Use only when a defensible labelled reference set or expert adjudication exists.

Record confusion matrix:

- true positives;
- false positives;
- true negatives;
- false negatives.

Then compute as applicable:

```text
Precision = TP / (TP + FP)
Recall = TP / (TP + FN)
F1 = 2 × precision × recall / (precision + recall)
```

For safety/resilience workflows, false negatives and false positives must be analyzed separately rather than hidden inside one aggregate score.

## 7. Triage performance

Possible measures:

- time from source arrival to first usable assessment;
- time from analyst start to triage completion;
- number of source/tool switches;
- number of manual evidence-reconciliation steps;
- number of escalations reviewed;
- analyst time per event.

Comparison must use equivalent event types and windows where possible.

Report median and distribution, not only the best case.

## 8. Human-review metrics

For each material AICIS output, allow reviewers to record:

- accepted as presented;
- accepted with edits;
- rejected;
- deferred/insufficient evidence.

Capture reason categories:

- evidence incomplete;
- evidence contradictory;
- irrelevant signal;
- wrong prioritization;
- unsupported inference;
- forecast uncertainty too high;
- duplicate/event-linking error;
- outdated data;
- useful but requires domain context;
- other.

Human acceptance alone is not proof of factual correctness, but it is useful workflow evidence.

## 9. Forecast evaluation

Only evaluate forecasting when the task, horizon and target are frozen before observing outcomes.

Record:

- target variable/event;
- forecast horizon;
- issue time;
- probability/point estimate;
- reference class/baseline forecast;
- observed outcome;
- calibration metric;
- missing/cancelled forecasts;
- model/version.

For binary probabilistic events, Brier score may be used:

```text
Brier score = mean((forecast_probability - outcome)^2)
```

Also inspect calibration by probability bucket when sample size permits.

Prediction is not causality. Causal language requires separate evidence and methodology.

## 10. Decision-trace completeness

For every consequential recommendation or proposed response option, record whether the trace contains:

- observed evidence;
- source provenance;
- timestamps;
- inference/model output clearly separated;
- uncertainty/confidence;
- human reviewer;
- reviewer decision;
- edits/overrides;
- final disposition.

Possible metric:

```text
Trace completeness = fully populated decision traces / total consequential outputs
```

## 11. Reliability and freshness

Record during evaluation:

- ingestion failures;
- delayed feeds;
- pipeline errors;
- UI/API downtime;
- processing latency;
- retry/recovery behavior;
- stale-data events;
- missing telemetry;
- security incidents or access-control failures.

Do not report model quality separately from data/pipeline reliability if operational usefulness depends on both.

## 12. Failure analysis

Every pilot report must include failures, including at minimum:

1. three most important false positives;
2. three most important false negatives where ground truth permits;
3. highest-impact provenance gaps;
4. important analyst rejections;
5. degraded/outage cases;
6. ambiguous cases where no confident conclusion was possible;
7. lessons and remediation.

A pilot with only success examples is not considered investor-grade validation.

## 13. Predeclared success criteria

Before the final evaluation run, agree thresholds where possible.

Example format only:

| Metric | Baseline | Target | Failure threshold | Evidence source |
| --- | ---: | ---: | ---: | --- |
| Median triage time | TBD | TBD | TBD | workflow timestamps |
| Traceable assessment rate | TBD | TBD | TBD | evidence ledger |
| Precision | TBD | TBD | TBD | adjudicated events |
| Recall | TBD | TBD | TBD | adjudicated events |
| Reviewer acceptance | TBD | TBD | TBD | review logs |
| Data freshness | TBD | TBD | TBD | ingestion telemetry |

Do not fill targets retrospectively to make results look successful.

## 14. Final report structure

Every investor-usable pilot report should contain:

1. executive summary;
2. partner/workflow context;
3. evaluation question;
4. baseline;
5. scope and exclusions;
6. data/source inventory;
7. methodology;
8. metrics;
9. results;
10. failure analysis;
11. security/privacy/regulatory constraints;
12. user feedback;
13. limitations;
14. go/no-go recommendation;
15. next-step commercial decision;
16. appendices with reproducible evidence.

## 15. Claim mapping

Create a claim table before using results externally:

| Proposed claim | Evidence | Scope | Limitation | Approved for investor use? |
| --- | --- | --- | --- | --- |
| Example: reduced median triage time | pilot timestamps | defined workflow only | shadow mode, limited sample | yes/no |

No metric may be generalized from one pilot to national/global effectiveness without additional evidence.

## Release condition

AICIS may say a workflow was **evaluated** when a controlled evaluation occurred.

AICIS may say a measured improvement occurred only when the baseline, protocol, data window and metric support it.

AICIS may say the product is **validated for a deployment class** only after the evidence is sufficiently broad, reproducible and appropriate for that claim. One successful pilot is not universal validation.
