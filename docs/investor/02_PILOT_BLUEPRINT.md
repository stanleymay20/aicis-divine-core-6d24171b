# AICIS — Design-Partner Pilot Blueprint

## Purpose

This document defines a truthful path from technical prototype to commercial evidence. It is a **proposed pilot structure**, not a claim that a pilot is already contracted or completed.

## Pilot objective

Validate whether AICIS can materially improve one existing resilience or continuity workflow for a real institution while preserving provenance, uncertainty and human accountability.

The pilot should answer a narrow question:

> Can AICIS help a defined operational team detect, triage and reason about a defined class of risks faster or more reliably than its current baseline process?

## Recommended first pilot profile

A suitable design partner is one of:

- a municipality or regional public body with resilience / emergency-coordination responsibilities;
- a public utility or infrastructure operator;
- a transport, telecom, energy or facilities operator with continuity responsibilities;
- a research or public-interest institution that can provide labelled historical scenarios and domain review.

The pilot should begin with **one workflow**, not a civilization-scale deployment.

## Scope template

Before implementation, agree in writing:

- decision workflow being evaluated;
- participating user roles;
- geographic / operational boundary;
- data sources and permissions;
- event classes to detect or assess;
- baseline process and baseline measurement period;
- evaluation dataset and ground-truth process;
- security and access requirements;
- retention and deletion requirements;
- escalation / human-approval rules;
- acceptance metrics;
- pilot duration and exit criteria.

## Example bounded use cases

Select only one for the first pilot:

1. **Infrastructure disruption triage** — combine service, weather, incident and public-signal feeds into evidence-linked operational summaries.
2. **Municipal resilience watch** — identify emerging cross-domain risks affecting local continuity and route them to human reviewers.
3. **Supply / service continuity** — detect correlated external signals that may affect a defined operational dependency.
4. **Critical-event evidence fusion** — reconcile multiple reports about the same event and preserve source lineage and uncertainty.

## Measurement framework

No target below is treated as achieved before measurement. Numerical thresholds should be agreed with the partner before the pilot begins.

### Data quality

- source availability and freshness;
- ingestion completeness;
- duplicate reduction;
- provenance coverage;
- unresolved / unknown-field rate.

### Detection and analytical quality

- precision and recall against human-labelled events where applicable;
- false-positive and false-negative rates;
- calibration / Brier score for probabilistic forecasts where applicable;
- lead time relative to the partner's current process;
- consistency of evidence-to-conclusion traceability.

### Workflow value

- median time from first signal to human triage;
- analyst time required per reviewed event;
- percentage of events requiring manual source reconciliation;
- review / override rate;
- user-rated usefulness collected through a defined instrument.

### Reliability and governance

- uptime during agreed pilot windows;
- ingestion failure rate;
- audit-log completeness;
- authentication / authorization test results;
- privileged-action traceability;
- number and severity of security or data-governance incidents.

## Evaluation design

Prefer one or more of:

- historical replay against labelled incidents;
- shadow mode alongside the existing workflow;
- controlled prospective pilot with human review before any operational consequence;
- blinded comparison of AICIS-assisted versus baseline triage on a defined sample.

Do not use production-critical autonomous actions as the first validation method.

## Pilot governance

AICIS must preserve these boundaries:

1. observed evidence is distinguishable from inferred analysis;
2. missing information remains explicitly unknown;
3. forecast probability is not presented as certainty;
4. causal language requires evidence appropriate to the claim;
5. consequential actions require authorized human review;
6. every material recommendation should be traceable to evidence and model / rule context;
7. evaluation failures are retained, not selectively hidden.

## Deliverables

A successful pilot process should produce:

- pilot charter;
- data-source register;
- threat / privacy assessment appropriate to scope;
- baseline measurement report;
- reproducible evaluation protocol;
- metric dashboard;
- failure / incident log;
- partner feedback record;
- final pilot report containing positive and negative results;
- go / no-go recommendation for paid continuation.

## Commercial conversion gate

Do not describe the pilot as traction merely because a party attended meetings. Commercial traction requires evidence such as a signed pilot agreement, paid invoice, procurement step, LOI with defined scope, or other verifiable commitment.

The strongest conversion path is:

```text
validated problem
→ signed design-partner scope
→ measurable pilot
→ successful evaluation
→ paid continuation / annual agreement
→ repeatable second customer
```
