# AICIS — AI Civilization Intelligence System

**AI-assisted early-warning, resilience and decision-support research platform**

AICIS is an applied AI and data-engineering project exploring how institutions can combine heterogeneous signals, structured evidence, forecasting and governed decision workflows to reason about complex socioeconomic, climate, infrastructure and governance risks.

The project is intentionally framed as a **decision-support system**, not an autonomous authority. Human review, provenance, access control and auditable intervention workflows are central design concerns.

## Recruiter quick scan

**Problem:** important operational risks arrive through fragmented, heterogeneous signals rather than one clean dataset.

**What this repository demonstrates:** React/TypeScript product engineering, Supabase/PostgreSQL data architecture, realtime pipelines, canonicalization and deduplication, evidence provenance, analytical/forecasting workflows, RLS, privileged server-side operations and human-review paths.

**Engineering signal:** AICIS keeps observed evidence, model inference and consequential action as distinct layers instead of collapsing them into one AI response.

## Commercial validation focus

The long-term AICIS vision is deliberately broad, but the first commercial validation target is narrow:

> **Evidence-governed resilience and continuity intelligence for municipalities, public institutions and critical-infrastructure operators.**

The first design-partner pilot should evaluate one bounded workflow—such as infrastructure-disruption triage, municipal resilience monitoring or critical-event evidence fusion—against a pre-agreed baseline and measurable success criteria.

AICIS is currently **pre-seed / pre-commercial validation**. This repository does not claim paying customers, revenue, signed pilots or independently validated operational impact unless such evidence is explicitly added later.

Controlled investor-readiness materials:

- [`docs/investor/01_ONE_PAGE_INVESTOR_BRIEF.md`](docs/investor/01_ONE_PAGE_INVESTOR_BRIEF.md)
- [`docs/investor/02_PILOT_BLUEPRINT.md`](docs/investor/02_PILOT_BLUEPRINT.md)
- [`docs/investor/03_COMMERCIAL_STRATEGY.md`](docs/investor/03_COMMERCIAL_STRATEGY.md)
- [`docs/investor/04_DATA_ROOM_INDEX.md`](docs/investor/04_DATA_ROOM_INDEX.md)
- [`docs/investor/05_PITCH_DECK_OUTLINE.md`](docs/investor/05_PITCH_DECK_OUTLINE.md)

## Development and public-interest relevance

AICIS investigates a practical development problem: important risks rarely arrive in one clean dataset. Climate pressure, economic continuity, infrastructure disruption, governance stability and humanitarian needs can interact, while decision-makers must still distinguish observed evidence from model inference.

The repository therefore explores capabilities relevant to:

- resilience and crisis-risk analysis;
- governance and institutional decision support;
- climate and infrastructure risk monitoring;
- economic-continuity analysis;
- humanitarian coordination workflows;
- multilingual access to operational information;
- evidence provenance and accountable AI-assisted recommendations.

Potential Sustainable Development Goal relevance includes **SDG 9 (Industry, Innovation and Infrastructure), SDG 11 (Sustainable Cities and Communities), SDG 13 (Climate Action) and SDG 16 (Peace, Justice and Strong Institutions)**. This mapping describes the problem domains addressed by the engineering work; it is not a claim of UN endorsement or measured SDG impact.

## Core questions

AICIS is organized around three questions:

```text
1. What is happening?
2. What evidence supports that assessment?
3. What response options should a human decision-maker review?
```

## System architecture

```text
Open APIs / Signals / Feeds
                ↓
Telemetry Intake Pipelines
                ↓
Canonicalization + Deduplication
                ↓
Enrichment + Relevance Scoring
                ↓
Causal / Predictive Analysis
                ↓
Evidence + Governance Review
                ↓
Decision-Support Interfaces
                ↓
Human Operational Coordination
```

## Implemented engineering areas

### Data and operational intelligence

- realtime telemetry surfaces;
- signal canonicalization and deduplication;
- enrichment and relevance scoring;
- cross-domain risk representations;
- operational summaries and spatial interfaces;
- typed data pipelines and database views.

### Forecasting and analytical support

- escalation and trend-analysis workflows;
- causal-propagation representations;
- memory-informed analytical components;
- multi-domain consequence analysis;
- structured risk variables covering areas such as economic continuity, governance stability and climate resilience.

These components support analytical experimentation. Forecasts and causal outputs should be validated for the specific data, geography and decision context before operational use.

### Governance and human review

- intervention-review surfaces;
- governance-agent and approval concepts;
- authenticated operational mutations;
- auditable workflow direction;
- evidence-provenance hardening;
- human-review pathways for sensitive decisions.

### Architecture and security

- React, TypeScript and Vite frontend;
- Supabase Postgres, Auth, Realtime and Edge Functions;
- multi-tenant architecture;
- Row-Level Security for user-facing data;
- server-side privileged workflows;
- secret validation for scheduled/privileged functions;
- typed operational pipelines.

## Evidence boundaries

AICIS is an evolving engineering and research system. The repository demonstrates implemented architecture, schemas, workflows and application logic, but it should **not** be interpreted as proof that the system has been independently validated for national security, humanitarian deployment, emergency management or global-scale forecasting.

Current hardening work includes:

- model and forecast validation;
- reliability engineering;
- production telemetry resilience;
- alert and incident lifecycle design;
- institutional onboarding;
- audit and evidence provenance;
- role-specific operational experiences.

This distinction is deliberate: claims about system effectiveness should remain proportional to the evidence available.

## Technology stack

**Frontend:** React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui · TanStack Query · React Router

**Backend/data:** Supabase Postgres · Supabase Auth · Supabase Realtime · Supabase Edge Functions

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm run build
```

Required public frontend configuration is documented in `.env.example`. Privileged credentials must remain server-side and must never be committed to source control.

## Design principles

AICIS prioritizes:

- evidence before recommendation;
- human accountability for consequential decisions;
- provenance and auditability;
- uncertainty-aware analysis;
- operational clarity over dashboard clutter;
- global-to-local context without assuming one model fits every location.

## Project direction

The long-term engineering goal is a governed environment in which heterogeneous risk signals can be transformed into traceable analysis and decision options for human review.

The immediate focus is narrower and testable: improve data provenance, analytical validation, security, reliability and the quality of evidence available to decision-makers.
