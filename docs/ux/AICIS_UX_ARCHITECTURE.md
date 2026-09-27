# AICIS Intelligence OS UX Architecture

## Product model

AICIS should behave as one intelligence operating system:

Observe → Understand → Investigate → Forecast → Decide → Monitor → Learn

Evidence, provenance, uncertainty, and Ask AICIS remain available across the flow.

## Primary workspaces

1. World — live situation, map, entities, signals and geographic context.
2. Brief — what changed, why it matters, what needs attention.
3. Analysis — research, comparisons, graphs, evidence and deep dives.
4. Forecasts — probabilities, scenarios, validation, outcomes and learning.
5. Opportunities — evidence-backed opportunity research.
6. Decisions — governed decisions, watchlists, monitoring and outcomes.
7. Data & Trust — provenance, evidence quality, integrity and operational truth.
8. System — pipelines, APIs, health, exports, federation and administration.

The route count is an implementation detail. New top-level workspaces require explicit product justification.

## Shell contract

The authenticated shell contains:

- Global top bar
- Consolidated workspace sidebar
- Workspace canvas
- Contextual Intelligence Inspector
- Command palette
- Runtime/context status bar
- Existing trust footer

## Entity contract

AICIS UI objects use the shared AICISEntity presentation model. This is a presentation/domain abstraction and does not require database tables to be merged.

Supported entity classes include countries, regions, localities, organizations, people, sectors, commodities, technologies, events, signals, risks, forecasts, opportunities, decisions, sources and pipelines.

## Truth-floor behavior

The UI must not manufacture confidence, freshness, evidence coverage, source counts or relationships.

Unknown remains UNKNOWN.
Unavailable remains unavailable.
Missing provenance must be displayed as missing provenance.

## Migration rule

Existing routes, deep links, role checks, access tiers and backend contracts remain authoritative while workspaces are progressively consolidated.
