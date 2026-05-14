# AICIS — AI Civilization Intelligence System

AICIS is an enterprise operational intelligence platform designed to help institutions detect, understand, coordinate, and respond to complex global risks in realtime.

The platform combines:
- realtime telemetry,
- planetary signal ingestion,
- causal propagation analysis,
- decision workflows,
- intervention governance,
- operational forecasting,
- multilingual intelligence translation,
- executive command interfaces.

AICIS is designed for:
- governments,
- enterprise operations centers,
- resilience teams,
- intelligence organizations,
- humanitarian coordination,
- strategic risk management,
- infrastructure monitoring.

---

# Core Operational Philosophy

AICIS is not merely an analytics dashboard.

It is designed as:

```text
planetary operational intelligence infrastructure
```

The system focuses on three core questions:

```text
1. What is happening?
2. Why does it matter?
3. What should we do next?
```

---

# Platform Capabilities

## Operational Intelligence

- Realtime operational telemetry
- Global-to-local intelligence routing
- Planetary command center
- Executive operational summaries
- Live operational streams
- Risk escalation monitoring
- Cross-domain intelligence coordination

## Predictive Intelligence

- Causal propagation modeling
- Escalation forecasting
- Memory-informed prediction
- Operational trend detection
- Multi-domain consequence analysis

## Decision Coordination

- Incident-to-decision workflows
- Intervention review surfaces
- Governance coordination
- Operator escalation pathways
- Executive recommendation systems

## Enterprise Architecture

- Multi-tenant architecture
- Supabase-backed operational infrastructure
- Row-level security (RLS)
- Edge-function orchestration
- Typed operational pipelines
- Realtime query infrastructure
- Operational observability direction

## Global Intelligence Accessibility

- Multilingual intelligence translation
- Region-aware operational routing
- Cross-border signal relevance
- Human-review workflows

---

# System Architecture

```text
Open APIs / Signals / Feeds
                ↓
Telemetry Intake Pipelines
                ↓
Canonicalization + Deduplication
                ↓
Enrichment + Relevance Scoring
                ↓
Causal + Predictive Intelligence
                ↓
Decision + Governance Workflows
                ↓
Executive Command Interfaces
                ↓
Operational Coordination
```

---

# Frontend Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn-ui
- TanStack Query
- React Router
- Lucide Icons
- Supabase Browser Client

## Primary Interfaces

- Planetary Command Center
- Realtime Operations Stream
- Operational Decision Workflow
- Planetary Operations Map
- Executive Briefing Surfaces
- Governance Interfaces
- Telemetry Monitoring
- Memory Forecasting
- Translation Operations

---

# Backend Infrastructure

- Supabase Postgres
- Supabase Auth
- Supabase Realtime
- Supabase Edge Functions
- Typed operational views
- Governance command views
- Realtime telemetry surfaces
- Operational pipeline orchestration

---

# Enterprise Security Model

## Security Principles

- No service-role exposure in frontend code
- All privileged workflows must remain server-side
- RLS enforced for user-facing operational data
- Operational mutations require authenticated workflows
- Cron workflows require secret validation
- Governance workflows should be auditable

## Authentication Classes

### Public

Read-only operational intelligence surfaces intentionally exposed for public access.

### Cron-Restricted

Operational ingestion and scheduled workflows requiring `CRON_SECRET` validation.

### Admin-Restricted

Privileged governance, ingestion, intervention, and operational coordination workflows.

---

# Operational Pipeline

```text
intake
→ canonicalization
→ enrichment
→ relevance scoring
→ propagation analysis
→ governance review
→ operational coordination
→ feedback learning
```

## Pipeline Goals

- Reduce signal overload
- Increase operational clarity
- Improve escalation visibility
- Coordinate interventions
- Support executive decisions
- Provide auditability and traceability

---

# Local Development

## Install

```bash
npm ci
```

## Configure Environment

```bash
cp .env.example .env.local
```

Required frontend variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

## Run Development Server

```bash
npm run dev
```

## Production Build

```bash
npm run build
```

## Lint + Typecheck

```bash
npm run lint
npm run typecheck
```

---

# Deployment

Supported deployment environments:

- Vercel
- Netlify
- Supabase
- Self-hosted Vite-compatible infrastructure

Recommended production command:

```bash
npm ci && npm run lint && npm run typecheck && npm run build
```

Output directory:

```text
dist
```

---

# Required Environment Variables

## Frontend

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

## Edge Functions / Server Infrastructure

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
AICIS_MODEL_ENDPOINT=
AICIS_MODEL_API_KEY=
AICIS_MODEL_NAME=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ALPHA_VANTAGE_API_KEY=
EIA_API_KEY=
```

Never expose:
- `SUPABASE_SERVICE_ROLE_KEY`
- model provider secrets,
- Stripe secrets,
- cron secrets,
- privileged operational credentials.

---

# Enterprise Hardening Status

## Strong Areas

- Enterprise operational UX
- Realtime operational architecture direction
- Operational workflow design
- Multi-domain intelligence structure
- Spatial intelligence interfaces
- Operational simplification and hierarchy
- Governance workflow direction

## Active Hardening Areas

- Operational observability
- Alert routing
- Incident lifecycle management
- Reliability engineering
- Production telemetry resilience
- Institutional onboarding
- Role-specific operational experiences
- Audit and evidence provenance

---

# Operational Design Principles

AICIS prioritizes:

- operational clarity over visual clutter,
- decision coordination over dashboard overload,
- realtime awareness over static analytics,
- systemic causality over isolated metrics,
- executive usability over feature sprawl.

The command center is intentionally evolving toward:

```text
calm, concise, enterprise operational coordination
```

instead of:

```text
high-noise dashboard complexity
```

---

# Troubleshooting

## Empty operational surfaces

Check:

1. Supabase environment variables
2. RLS policies
3. Operational views
4. Edge function deployments
5. Telemetry ingestion jobs
6. Browser console and Supabase logs

## Unauthorized operational workflows

Check:

1. JWT authentication
2. Admin role metadata
3. Cron secret validation
4. Operational RLS rules

## Realtime issues

Check:

1. Supabase realtime configuration
2. Websocket connectivity
3. Query invalidation strategy
4. Operational polling intervals
5. Telemetry pipeline status

---

# Commercial Positioning

AICIS is positioned at the intersection of:

- operational intelligence,
- resilience coordination,
- realtime decision systems,
- global risk monitoring,
- enterprise command infrastructure.

The long-term vision is to provide:

```text
a global-to-local operational intelligence coordination environment
```

for institutions operating in increasingly complex environments.
