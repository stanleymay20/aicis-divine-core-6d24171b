# AICIS Intelligence OS — UI/UX v2.0 Freeze

Status: **DESIGN / CODE FREEZE ACTIVE**

Verified authority SHA: `c7f420ee7a20f1563262f6b8b3233f96e3a04b91`

Freeze date: 2026-09-27

## Release-gate evidence at freeze authority

The verified authority SHA passed:

- CI
- Strict lint
- Legacy lint debt ratchet
- Typecheck
- Production build
- Verification summary
- Authentication Boundary Proof
- Security DB Behavioral Proof
- CodeQL

## Product contract

AICIS exposes eight primary workspaces:

1. World
2. Brief
3. Analysis
4. Forecasts
5. Opportunities
6. Decisions
7. Data & Trust
8. System

Legacy and specialist routes remain supported as workspace modes, aliases, drill-downs, or deep links. They must not expand the primary navigation unless a later product decision explicitly changes this contract.

## Core interaction model

AICIS should feel simple at the surface and sophisticated underneath.

Primary interaction grammar:

World → Signal / Entity → Evidence → Analysis → Forecast → Decision → Outcome

Users should normally be able to:

- see what matters,
- ask AICIS,
- inspect an intelligence object,
- move across workspaces without losing context,
- progressively disclose deeper evidence and system detail.

## Global shell contract

The authenticated shell includes:

- canonical eight-workspace sidebar,
- workspace-aware top bar,
- Ctrl / Command-K command palette,
- responsive Intelligence Inspector,
- mobile inspector drawer,
- workspace/context status,
- trust/footer surfaces.

Sidebar, Top Bar, and Command Palette share the canonical workspace definition and must not drift independently.

## Intelligence Inspector contract

The Inspector is contextual rather than a separate product silo.

It may render:

- overview,
- supplied attributes,
- evidence,
- signals,
- forecasts,
- relationships,
- history,
- Ask AICIS.

Tabs that lack supplied supporting data must be disabled or clearly unavailable rather than implying missing functionality.

Values in metadata are rendered as supplied. The Inspector must not infer missing units, confidence, freshness, source count, or unavailable values.

## Cross-workspace context

Entity context is URL-addressable and session-preserved.

- Shareable identity: `?entity=TYPE:ID`
- Rich entity context may persist for the current browser session.
- Selected entity and active investigation question may follow workspace navigation.
- Permanent local-storage persistence of intelligence entity context is not part of this contract.

## Ask AICIS / research contract

Ask AICIS may carry the active entity and question into the Analysis workspace.

The governed evidence-research surface:

- uses the existing `aicis-intelligence` backend,
- requires an explicit research action,
- uses stored evidence only,
- does not manufacture fallback answers,
- does not invent confidence, sources, or evidence freshness,
- distinguishes response-generation time from evidence freshness,
- treats zero evidence as UNKNOWN rather than LOW risk.

## Truth-floor contract

Across AICIS:

- unknown remains UNKNOWN,
- unavailable remains unavailable,
- no-data is not the same as query failure,
- query failure is not displayed as zero work,
- zero evidence is not displayed as low risk,
- missing confidence does not receive a default score,
- missing source count is not synthesized,
- missing freshness is not replaced with the current time,
- research state is not transaction execution state,
- proposed actions are not recorded as executed without explicit execution state,
- unverified "live" claims are prohibited.

## Workspace-specific contract

### World

World is the geographic and situational center. Countries, incidents, and live signals select typed intelligence objects and open the shared Inspector. Governed layer state is shareable.

### Brief

Brief follows:

What changed → Why it matters → What needs attention

It uses stored metrics and evidence context and does not synthesize financial exposure, ROI, or historical precedents.

### Analysis

Overview, Research, Graph, and Geography behave as one workspace. Ranked forecasts and related intelligence objects can open in the shared Inspector.

### Forecasts

Validation, Predictions, Scenarios, Outcomes, and Learning behave as one workspace. Existing probability / calibration semantics remain authoritative.

### Opportunities

Opportunity research is evidence-backed and remains distinct from execution, investment, or transaction state.

### Decisions

Decision, watchlist, metric, and status surfaces must distinguish stored state, failure state, and absence of work.

### Data & Trust

Evidence, Validation, Truth, Coverage, Governance, and Integrity behave as one workspace. Operator-only integrity surfaces retain role protection.

### System

Status, Operations, Developers, Exports, Federation, and Admin behave as one workspace.

System discovery is allowed for authenticated users, but privileged actions remain role-gated. Read-only users must not receive operator controls such as watchdog execution.

## Responsive contract

- Phone: primary workspace plus mobile drawer / bottom-sheet inspector.
- Tablet: preserve workspace canvas width; inspector uses reduced desktop width.
- Desktop: full workspace + contextual inspector.
- Desktop cockpit layouts must not merely be scaled down onto mobile.

## Post-freeze policy

After this freeze:

- Do not redesign the information architecture without explicit product review.
- Do not add new primary workspaces casually.
- Do not reintroduce duplicated workspace navigation.
- Do not weaken truth-floor semantics for visual convenience.
- Do not add synthetic metrics to make empty states appear richer.
- Prefer defect fixes, accessibility improvements, performance improvements, and evidence-backed usability changes.
- Any material redesign should begin as a new versioned UX proposal rather than silently modifying v2.0.

## Final interactive QA note

A live-browser interactive smoke run was prepared for the Lovable preview but could not start because the connected browser-automation wallet had insufficient balance.

This does **not** invalidate the engineering freeze evidence above. It means final browser-interaction QA remains an explicit release-validation item.

Until that smoke run is completed, any browser-specific defect discovered manually or by automation should be treated as a **defect-only exception to the freeze**, not a reason to reopen the UI/UX architecture.
