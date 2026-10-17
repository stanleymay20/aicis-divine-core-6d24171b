# AICIS Route Migration Map

This document preserves existing URLs while defining their future workspace ownership.

## World

/world
/situations
/command-center
/spatial-cockpit
/cockpit
/risk-atlas
/live
/live-signals
/live-stream
/local-events
/atlas/region/:id

`/situations` is the first governed Situation read-model surface. Its implementation contract is `docs/SITUATION_READ_MODEL_V1.md`. It is a read-only projection over existing governed records, not a new source of truth.

Long-term behavior: these become World modes, layers or drill-down states. Existing URLs remain aliases until migration tests prove parity.

## Brief

/morning-brief
/brief/today

## Analysis

/analyst
/analyst-dashboard
/intelligence-engine
/planetary-intelligence
/planetary-graph
/resolution
/deepdive/:iso3
/risk-ranking

## Forecasts

/forecast-validation
/predictions
/simulation
/learning
/learning-loop
/outcome-cockpit

## Opportunities

/opportunities

## Decisions

/decision-ops
/decisions
/watchlist

## Data & Trust

/governance
/evidence-command
/daily-evidence-ops
/signal-validation
/operational-truth
/coverage-equity
/pilot-truth
/data-integrity
/training-dataset
/accumulation

## System

/system-pulse
/system-status
/system-catalog
/infra-ops
/data-pipeline
/api-audit
/developers
/admin
/export-center
/data-export
/export-layer
/exports
/quantivis-exports
/federation-admin
/register-node

## Safety rules

- Do not delete an old URL during the first migration stage.
- Do not bypass ProtectedRoute, role or tier gates.
- Browser back and forward must remain correct.
- Query-state migration must be shareable and deterministic.
- Route aliases must be covered by smoke tests before cleanup.
- Situation routes must preserve `docs/SITUATION_READ_MODEL_V1.md` truth boundaries until a later controlled Situation persistence contract supersedes them.
