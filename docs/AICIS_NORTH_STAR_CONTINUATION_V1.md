# AICIS North Star & Continuation Contract v1

Status: controlled product / engineering direction  
Effective date: 2026-10-17  
Applies to: humans, coding agents, review bots and future continuation sessions

## 1. Why this document exists

AICIS has a deliberately broad long-term ambition, but it must not drift into a generic AI dashboard, a general-purpose chatbot, an unvalidated “world predictor,” or a collection of disconnected features.

This document is the canonical continuation contract for the current direction of AICIS. Any agent or contributor resuming work should read this file before proposing significant product, architecture, forecasting, commercial or UI changes.

If another document conflicts with this file, preserve the stricter evidence / safety boundary and surface the conflict before changing production behavior.

## 2. North-star definition

AICIS is an **evidence-governed intelligence and decision-support system** that transforms fragmented real-world signals into traceable situations, uncertainty-aware analysis, scientifically governed forecasts and human-reviewed decision options — then learns when reality resolves.

The target lifecycle is:

```text
Observe
  ↓
Verify
  ↓
Understand
  ↓
Forecast
  ↓
Simulate
  ↓
Decide
  ↓
Act
  ↓
Resolve
  ↓
Learn
```

The final two stages — **Resolve → Learn** — are strategic, not cosmetic. AICIS should accumulate evidence about what actually happened, how forecasts performed, which decisions humans took, and what outcomes followed. That history is intended to become part of the system's long-term defensibility.

## 3. What AICIS is not

AICIS must not be described or implemented as any of the following unless future evidence explicitly justifies the claim:

- an autonomous authority for consequential decisions;
- a validated system for predicting “the world” or “civilization” in general;
- a substitute for human legal, emergency, national-security, humanitarian or public-administration authority;
- a generic LLM wrapper whose main value is text generation;
- a dashboard that hides source uncertainty behind polished numbers;
- a system that treats model output as ground truth;
- a product that manufactures confidence when evidence is missing;
- a certified or compliant system merely because supporting security controls exist.

## 4. Non-negotiable truth doctrine

All future work must preserve these rules:

1. **Unknown stays unknown.** Missing confidence, calibration, source coverage, provenance or outcome data must not silently become zero, 50%, “safe,” “healthy,” or another synthetic value.
2. **Evidence, inference and action remain distinct.** Observed facts, model-derived claims and consequential recommendations must never be collapsed into one undifferentiated answer.
3. **Prediction is not causality.** Predictive association, temporal order or graph propagation does not establish intervention effect.
4. **Future means future.** Scientific forecasting may only use evidence legitimately knowable at the forecast origin under the governed knowledge-time contract.
5. **Abstention is a valid result.** When evidence is insufficient, AICIS should refuse or narrow the forecast instead of fabricating certainty.
6. **Human accountability remains explicit.** Consequential decisions require authorized human review unless a separately governed low-risk automation contract says otherwise.
7. **Claims must be proportional to evidence.** “Pilot,” “customer,” “validated forecasting,” “production ready,” “compliant,” “improves decisions,” and similar terms require the evidence gates defined in controlled documentation.

The scientific implementation source of truth remains `docs/AICIS_SCIENTIFIC_FORECASTING_PROTOCOL_V1.md` for registered forecasting claims.

## 5. Commercial strategy: narrow wedge, broad expansion path

The long-term vision is multi-domain intelligence. The first commercial wedge remains intentionally narrow:

> **Evidence-governed operational resilience and continuity intelligence for public institutions and critical-infrastructure operators.**

The first workflow should be bounded enough to measure against an existing process. Preferred examples include:

- infrastructure-disruption triage;
- municipal resilience monitoring;
- critical-event evidence fusion;
- cross-source incident reconciliation and escalation support.

AICIS should first prove that it can help a real team answer:

```text
What happened?
Is it real?
Are multiple reports describing the same situation?
Which evidence conflicts?
What assets or entities may be affected?
What remains unknown?
What requires human review now?
```

Only after the evidence and operational loop works reliably should forecasting authority expand.

AICIS should compete first against the **current workflow** — disconnected dashboards, spreadsheets, email/chat escalation, analyst reconciliation and manual provenance tracking — not by claiming to replace every intelligence platform.

## 6. The golden product object: Situation

AICIS should converge around a canonical **Situation** object rather than around a growing collection of dashboards.

A Situation is the governed container that links:

- observed facts and events;
- immutable source artifacts and provenance;
- source-independence / corroboration groups;
- contradictions and unresolved claims;
- valid time, publication time, knowledge time and ingestion time;
- affected entities, assets, places and relationships;
- evidence coverage and missingness;
- forecasts and their exact task / model / calibration versions;
- scenario assumptions and alternative futures;
- decision options and constraints;
- authorized human review and chosen action;
- later resolution evidence and actual outcome;
- forecast / decision evaluation history.

Dashboards, maps, alerts, Ask AICIS, reports and APIs should increasingly become **views over governed Situations and their evidence**, not separate truth systems.

## 7. Target architecture

The product should evolve toward these logical layers:

```text
1. Signal Layer
   APIs / feeds / internal systems / public data / telemetry

2. Evidence Fabric
   immutable artifacts / provenance / hashes / source independence / time semantics

3. Entity & Situation Layer
   normalized entities / assets / places / relationships / events / situations

4. Observation Layer
   what AICIS knows, when it became legitimately knowable, and what is missing

5. Forecast Layer
   registered tasks / baselines / challengers / ensembles / sealed forecasts

6. Calibration & Abstention Layer
   empirical calibration / disagreement / coverage / drift / refusal conditions

7. Scenario Layer
   conditional futures / propagation / assumption-aware simulation

8. Decision Layer
   options / constraints / trade-offs / expected consequences

9. Governance Layer
   identity / authorization / approvals / audit / policy

10. Action Layer
    alerts / tickets / integrations / approved operational workflows

11. Resolution Layer
    governed evidence of what actually happened

12. Learning Layer
    forecast scoring / decision-outcome history / model and workflow evaluation
```

The web application is one interface to this architecture. Over time, APIs, agents and external integrations may expose the same governed intelligence in other systems.

## 8. Long-term moat hypothesis

The moat is not the frontend, a particular LLM, Supabase, or one forecasting model.

The defensibility hypothesis is the compound system:

> **Evidence Graph + Temporal Truth + Forecast History + Decision History + Resolved Outcomes + Institutional Integration**

The intended flywheel is:

```text
More real situations
  → more governed evidence
  → more sealed forecasts
  → more reviewed decisions
  → more resolved outcomes
  → better evaluation and calibration
  → better workflows
  → more trust and adoption
  → more real situations
```

This is a hypothesis until AICIS accumulates real deployments and resolved evidence. Do not describe the moat as proven before then.

## 9. Product and engineering priority test

Before adding a significant feature, ask:

1. Does this improve the Observe → Verify → Understand → Forecast → Simulate → Decide → Act → Resolve → Learn loop?
2. Does it strengthen evidence quality, provenance, temporal truth, calibration, decision traceability or operational usefulness?
3. Does it help the first resilience / continuity workflow reach measurable real-world validation?
4. Does it preserve the truth floor and human-review boundaries?
5. Is the capability already implemented elsewhere in the repo under another name?
6. Can the change be verified end-to-end rather than merely rendered in UI?

If the answer is mostly “no,” defer the feature.

## 10. Current controlled truth as of 2026-10-17

AICIS is **pre-seed / pre-commercial validation**.

The repository contains substantial engineering, evidence-governance and forecasting architecture. However, the following must remain unclaimed unless later evidence is added:

- paying customers;
- revenue;
- signed production deployments;
- independently validated operational impact;
- general world-prediction capability;
- empirically established cross-domain forecasting superiority;
- product-market fit;
- completed SOC 2 / ISO 27001 certification or other certifications merely because controls exist;
- universal GDPR / HIPAA compliance claims without deployment-specific legal and technical review.

Four relevant organizations had documented outreach sent on 2026-10-05. Outreach alone is not traction, a pilot, a partnership or demand validation.

## 11. Forecasting state and migration boundary

The scientific forecasting architecture is intentionally stricter than ordinary product analytics.

- `docs/AICIS_SCIENTIFIC_FORECASTING_PROTOCOL_V1.md` governs scientific forecasting claims.
- Forecasts must use registered targets, legitimate knowledge-time cutoffs, mandatory baselines, proper scoring and sealed prospective evaluation before operational promotion.
- Calibration requires resolved evidence; a model-emitted probability is not automatically calibrated.
- Forecast ledger deployment must not bypass migration, behavioral-proof or non-production validation gates.
- PR #31 (`feat/forecast-ledger-migration-v1`) is explicitly quarantined and must not be merged merely for branch cleanup.

## 12. Immediate continuation sequence

Unless a new P0/P1 defect or explicit user priority overrides it, the preferred continuation sequence is:

### Phase A — truth and architecture alignment

- keep repository claims evidence-bounded;
- remove or qualify stale “enterprise-ready” / certification language that exceeds evidence;
- make this continuation contract discoverable from `AGENTS.md` and `README.md`;
- preserve existing working behavior and controlled migrations.

### Phase B — one complete Situation workflow

Build / verify one vertical slice using real or production-representative sources:

```text
source artifact
  → canonicalized evidence
  → Situation
  → contradiction / coverage state
  → affected entities / assets
  → analyst triage
  → human-reviewed disposition
  → governed resolution
```

Measure the workflow rather than only the UI.

### Phase C — prospective forecasting in shadow mode

For one precisely registered task:

- establish simple baselines first;
- create immutable prospective forecasts;
- preserve evidence and model manifests;
- abstain when the contract is not met;
- resolve using an external or independently governed authority;
- score forecasts after resolution;
- keep operational authority off until promotion gates are met.

### Phase D — economic proof

For a real design partner when available, compare AICIS against the existing workflow using measurable outcomes such as:

- time-to-triage;
- analyst reconciliation time;
- provenance coverage;
- duplicate / conflicting-source handling;
- missed or false escalations;
- human override rate;
- decision auditability;
- forecast skill and calibration when enough resolved evidence exists.

## 13. Continuation rules for coding agents

When resuming this repository:

1. Read `AGENTS.md`.
2. Read this file.
3. Read `README.md`.
4. Read the controlled document relevant to the task (forecasting, investor, migration, security, UI, etc.).
5. Inspect current `main`, open PRs, exact-head CI and runtime contracts before changing code.
6. Do not scaffold a replacement implementation because the existing architecture is complex.
7. Do not weaken RLS, auth, migration, evidence, forecast, security or CI gates to make a change pass.
8. Do not merge a branch whose exact current head has not passed the required checks.
9. Do not silently turn hypotheses, candidates or documentation into deployed runtime claims.
10. When evidence is missing, write `unknown`, `unverified`, `candidate`, `not deployed`, or the appropriate controlled state instead of inferring success.

## 14. Definition of progress

AICIS has made meaningful progress when it increases **verified operational capability**, not simply repository size.

The strongest future milestone is not “more AI features.” It is repeatedly completing this real loop:

> **Real source → traceable evidence → governed Situation → sealed forecast where appropriate → human decision → real outcome → measurable learning.**

That is the path from an ambitious research platform toward a trustworthy intelligence system.
