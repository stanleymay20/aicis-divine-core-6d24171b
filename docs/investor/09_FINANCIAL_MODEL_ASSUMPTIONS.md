# AICIS Financial Model Assumptions Framework

## Purpose

This document defines how AICIS should build a 24–36 month investor model without presenting unsupported revenue forecasts as facts.

Every commercial number belongs in one of three states:

- **Verified:** supported by contract, invoice, payroll quote, cloud bill or other evidence;
- **Quoted:** supported by a supplier/customer quote but not yet incurred/contracted;
- **Hypothesis:** planning assumption that still requires validation.

Investor materials must label the state of material assumptions.

## Model structure

Build monthly columns for at least 36 months and separate:

1. revenue drivers;
2. direct cost of service;
3. payroll;
4. product/engineering infrastructure;
5. sales/customer-success costs;
6. legal, insurance and administration;
7. grants/non-dilutive funding;
8. financing/equity cash flows;
9. cash balance and runway.

Do not net grants into customer revenue.

## Revenue architecture

### Stage 1 — design-partner / validation

Possible commercial forms:

- funded research collaboration;
- paid pilot;
- cost-recovery pilot;
- grant-supported pilot.

Until a buyer validates pricing, use scenario ranges internally rather than claiming an established market price.

Suggested **pricing-test hypotheses only**:

- small scoped paid pilot: **€10k–€30k**;
- more complex multi-source pilot: **€30k–€75k**;
- annual departmental subscription after validation: **€30k–€100k ARR**;
- larger multi-unit/enterprise deployment: **€100k+ ARR**, subject to procurement, integration and support scope.

These are not validated prices or revenue forecasts. Replace them with observed willingness-to-pay and executed contract values as evidence appears.

### Stage 2 — repeatable annual contracts

Potential recurring components:

- platform subscription;
- organization/workspace fee;
- usage/data volume;
- premium data connectors;
- governance/audit modules;
- deployment/integration support;
- enterprise support/SLA;
- optional professional services.

Professional services should be modeled separately from software ARR so gross margins are not overstated.

## Core revenue formulas

For each month:

```text
New pilot revenue = signed paid pilots × average recognized pilot value

New ARR = newly activated recurring customers × average annual recurring contract value

MRR = active ARR / 12

Expansion ARR = eligible active customers × expansion rate × average expansion amount

Churned ARR = renewable ARR × gross revenue churn rate
```

Only executed agreements count as booked revenue. Pipeline belongs in a separate probability-weighted planning tab.

## Pipeline model

Track stages independently:

1. qualified target;
2. discovery completed;
3. strong use-case fit;
4. pilot proposed;
5. procurement/security review;
6. signed pilot;
7. pilot completed;
8. paid continuation;
9. recurring customer;
10. expansion.

For investor reporting, show raw counts and conversion rates. Do not call discovery meetings "customers" or pilot discussions "bookings."

## Direct cost of service

Track direct costs by customer/pilot where possible:

- cloud compute;
- database/storage;
- observability/logging;
- external APIs/data feeds;
- model/API inference;
- mapping/geospatial services;
- dedicated environments;
- support directly attributable to delivery;
- security/compliance tooling required per deployment.

Formula:

```text
Gross profit = recognized customer revenue - direct cost of service
Gross margin = gross profit / recognized customer revenue
```

Do not classify founder salary or general R&D as direct cost solely to inflate gross margin; apply a consistent accounting policy.

## Payroll plan

Model roles, not imaginary hires. Suggested capability sequence:

### Near-term

- founder / product-technical lead;
- optional part-time domain/advisory support;
- legal/accounting on external basis.

### After evidence / funding

Potential roles should be triggered by milestones:

- data/ML engineer — when validation and data-pipeline load justify it;
- senior backend/platform engineer — when enterprise reliability/integration becomes a bottleneck;
- domain/resilience specialist — when pilot interpretation requires dedicated expertise;
- customer implementation/success — when multiple pilots/customers run concurrently;
- enterprise/GovTech sales — only after repeatable buyer/use-case evidence.

For every planned hire include:

- start month;
- gross salary;
- employer payroll burden;
- recruiting/equipment cost;
- trigger/milestone.

## Operating expenses

Separate at minimum:

- software/developer tools;
- cloud/platform fixed costs;
- data subscriptions;
- security/compliance;
- legal and IP;
- accounting/tax;
- company formation/governance;
- insurance;
- travel/customer discovery;
- marketing/events;
- office/coworking if any;
- hardware/equipment.

## Cash and runway

```text
Net burn = cash operating outflows - cash operating inflows

Runway months = current unrestricted cash / current or forward-looking monthly net burn
```

For a pre-revenue company, distinguish:

- founder-funded cash;
- grants/non-dilutive cash;
- restricted project funding;
- investor cash;
- customer cash.

## Fundraising scenarios

Build at least three scenarios.

### Lean validation

Objective: first design partner, first measured pilot, company/diligence readiness.

Model the minimum cash needed to reach evidence milestones, not arbitrary runway.

### Pre-seed base case

Objective: multiple validated pilots, first recurring contracts, hardened deployment path, small core team.

### Accelerated case

Objective: parallel pilots/integrations and faster enterprise readiness after strong pull is demonstrated.

Each scenario must state the milestone the cash is intended to buy.

## Use-of-funds logic

Use-of-funds should map directly to risk reduction:

- product validation;
- data/model validation;
- security/reliability;
- first design-partner deployments;
- legal/IP/entity setup;
- customer discovery/GTM;
- critical hires.

Avoid vague categories such as "growth" without explaining the evidence milestone.

## Investor KPI set

Before revenue:

- qualified discovery interviews;
- strong-fit opportunities;
- written pilot scopes;
- signed pilots;
- measured pilot outcomes;
- time from discovery to pilot agreement;
- cash/runway;
- engineering/reliability milestones.

After customer revenue begins:

- pilot revenue;
- ARR/MRR;
- gross margin;
- paid-pilot → recurring conversion;
- sales cycle;
- expansion;
- churn/retention;
- implementation effort per customer;
- burn multiple when meaningful.

## Evidence upgrade rule

Whenever an assumption becomes evidenced:

1. store the supporting artifact in the controlled data room;
2. replace the hypothesis value with the verified/quoted value;
3. record date/source;
4. update scenarios;
5. update pitch materials only after the data room and model agree.

## Current truth boundary

Until real commercial evidence exists, AICIS should describe its financial model as a **planning model**, not historical company performance. No revenue, customer count, ARR, signed-pilot value or willingness-to-pay should be presented as achieved unless documentary evidence exists.
