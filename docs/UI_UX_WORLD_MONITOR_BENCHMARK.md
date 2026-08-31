# AICIS UI/UX reconstruction benchmark — World Monitor reference

Status: design and information-architecture checkpoint only. No production deployment, data writer, cron activation, or live-system change is authorized by this document.

## Executive conclusion

AICIS currently exposes a broader conceptual system than World Monitor, but World Monitor communicates its product more effectively. The decisive advantage is not simply color, typography, or polish. It is information architecture: World Monitor places the geographic intelligence surface at the center, organizes supporting intelligence into bounded panels, lets users progressively disclose detail, and makes navigation feel subordinate to the intelligence task.

AICIS presently does the reverse too often. Its product architecture is exposed directly as navigation and page taxonomy. The result is a large number of routes and branded concepts competing for attention before the user has established situational context.

The reconstruction target is therefore:

> World Monitor-level visual clarity and spatial intelligence + AICIS-level provenance, temporal integrity, reasoning, forecasting, governance, and verified outcomes.

AICIS must not clone World Monitor code, branding, or visual identity. World Monitor is an AGPL-licensed project and also has separate trademark/branding considerations. The benchmark is for interaction principles and information architecture, not source copying.

## Evidence inspected

### AICIS

- `src/App.tsx`: very broad route surface, including overlapping aliases and many separately named operational concepts.
- `src/components/aicis/AICISLayout.tsx`: persistent top bar + sidebar + page canvas with a decorative radial/grid background.
- `src/components/aicis/AICISSidebar.tsx`: five top-level conceptual groups — Sense, Understand, Decide & Act, Learn, Operate — with roughly twenty visible navigation destinations depending on role.
- `src/pages/PlanetaryCommandCenter.tsx`: hero, six KPI cells, six neural-flow stage cards, then the map, current judgment, decision workflow, live stream, and system integrity.

### World Monitor

- Project README: unified real-time situational-awareness dashboard; map/globe is a first-class product surface.
- Country intelligence docs: country click opens a focused dossier using a two-column synthesis rather than requiring the user to hunt across many independent pages.
- Panel layout manager: panel inventory, persisted layout, tabs, deferred panel shells, responsive layout, premium gating, fullscreen state, collapsed state, keyboard reordering, and layout persistence are treated as one coherent dashboard system.
- Map architecture: WebGL flat map plus 3D globe, mobile fallback, many map layers, contextual overlays and country intelligence.

## Forensic comparison

| Dimension | AICIS today | World Monitor pattern | AICIS target |
|---|---|---|---|
| Primary visual anchor | Command page begins with brand/hero, KPI strip and process cards; map appears lower | Map/globe is the primary situational surface | Map-first intelligence workspace |
| Navigation | Product architecture exposed as many named routes | Dashboard/panels/layers keep most work inside one operational surface | 5-7 primary destinations; deeper functions become contextual views |
| Cognitive load | Multiple branded concepts: Nervous System, Planetary Field, Causal Intelligence, Threat Matrix, Decision Operations, Scenario Studio, Intervention Outlook, etc. | Fewer mental models; task is “monitor world, inspect signal/country/panel” | One consistent vocabulary: Observe, Understand, Forecast, Decide, Verify |
| Information density | Large vertical page with many full-width sections | Dense but bounded panels around spatial anchor | Adaptive three-zone workspace |
| Progressive disclosure | Many routes are first-class navigation | Clicking map/country/signal opens deeper contextual intelligence | Drawers, inspector, fullscreen panels, dossier routes only when justified |
| Customization | Mostly fixed page composition | Panels/layers/tabs can be enabled, collapsed, reordered, persisted | Mission presets + panel visibility + saved workspace state |
| Spatial continuity | Moving between pages can lose geographic context | Geographic context remains central | Selected country/region/time range persists across modules |
| Visual hierarchy | Similar rounded-card treatment across many sections | Strong distinction between map, toolbar, panel, alert and dossier | Explicit surface hierarchy, fewer decorative containers |
| Mobile | Sidebar drawer and responsive grids | Mobile-specific map/panel strategy | Mission-first mobile layout with bottom sheet inspector |
| Product differentiation | Strong concepts but fragmented | Strong situational-awareness communication | AICIS reasoning/provenance visibly attached to every signal and forecast |

## Core diagnosis

### 1. AICIS has a route explosion problem

`App.tsx` exposes dozens of routes, several with aliases. This makes the application architecture legible to developers but burdens users with too many possible destinations. A user should not need to understand the internal ontology before obtaining situational awareness.

Recommendation: separate **URL capability** from **primary navigation**. Routes may remain for deep links, access control, and backward compatibility, but most should stop appearing as peer navigation destinations.

### 2. The command center delays the strongest visual object

The current `PlanetaryCommandCenter` renders:

1. brand/mission hero
2. six system KPIs
3. six process-stage cards
4. only then the planetary map

This explains part of the perceived difference. A global-intelligence product should establish “where and what is happening” almost immediately. Process-state explanation is secondary.

Recommendation: map should occupy the dominant first viewport on desktop. System readiness, epistemic state, and workflow status become compact strips or contextual panels.

### 3. AICIS uses cards as a default container rather than as a semantic object

Repeated rounded bordered surfaces reduce hierarchy because map, workflow, health, narrative, KPI and process stage all receive similar visual weight.

Recommendation: define semantic surfaces:

- **Canvas** — map/world state
- **Rail** — navigation and mission switching
- **Panel** — bounded intelligence module
- **Inspector** — contextual evidence/provenance/detail
- **Alert** — interruptive time-sensitive signal
- **Dossier** — full-depth country/entity view
- **Control surface** — filters/layers/time/mode

### 4. The strongest AICIS differentiators are not visually attached to intelligence

AICIS has richer aspirations around evidence, chronology, causal reasoning, predictions, decision governance, and outcome verification, but those capabilities are currently represented as destinations. The better design is to attach them to the object being inspected.

Example: clicking an event should expose tabs for Summary / Evidence / Timeline / Causal links / Forecasts / Decisions / Outcomes instead of requiring the user to navigate separately to Evidence Command, Causal Intelligence, Predictions, Decision Operations, and Forecast Validation.

## Target information architecture

### Primary navigation — maximum seven items

1. **World** — default map-first operating workspace.
2. **Brief** — executive/daily intelligence synthesis.
3. **Analysis** — analyst workspace, causal graph, comparison and deep research.
4. **Forecasts** — predictions, scenarios, calibration and outcome verification.
5. **Decisions** — governed decision workflows, interventions and watchlists.
6. **Data & Trust** — evidence quality, provenance, pipeline, coverage and governance.
7. **System** — operator/admin health, readiness, audit and configuration; hidden for users without the role.

Legacy routes remain available as contextual/deep-link routes until deliberate migration proves they can be consolidated safely.

## Default World workspace

Desktop target:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ AICIS | mission/search | time | layers | alerts | freshness | user          │
├───────┬───────────────────────────────────────────────┬──────────────────────┤
│ rail  │                                               │ contextual inspector │
│       │                 WORLD MAP                     │                      │
│ World │                                               │ selected object      │
│ Brief │          signals / flows / regions            │ summary              │
│ Anal. │                                               │ evidence             │
│ Fcst. │                                               │ timeline             │
│ Dec.  │                                               │ forecasts            │
│ Trust │                                               │ decisions            │
│       │                                               │ provenance           │
├───────┴───────────────────────────────────────────────┴──────────────────────┤
│ compact live intelligence strip / optional panel tray                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Desktop proportions at normal width:

- collapsed navigation rail: 56–64 px
- central intelligence canvas: flexible, roughly 65–75% of remaining width
- inspector: 340–420 px, collapsible
- top command bar: 44–52 px
- optional bottom event tray: 180–320 px when opened

The first viewport should communicate global state without scrolling.

## Component hierarchy

```text
AICISWorkspaceShell
├── IntelligenceCommandBar
│   ├── MissionSwitcher
│   ├── GlobalSearch
│   ├── TimeWindowControl
│   ├── LayerControl
│   ├── FreshnessIndicator
│   ├── AlertCenter
│   └── UserWorkspaceMenu
├── PrimaryRail
├── WorkspaceCanvas
│   ├── WorldMapSurface
│   │   ├── MapLayerStack
│   │   ├── MapLegend
│   │   ├── MapModeControl
│   │   └── SpatialSelection
│   ├── ContextInspector
│   │   ├── SummaryTab
│   │   ├── EvidenceTab
│   │   ├── TimelineTab
│   │   ├── CausalTab
│   │   ├── ForecastsTab
│   │   ├── DecisionsTab
│   │   └── OutcomesTab
│   └── IntelligenceTray
│       ├── LiveEventsPanel
│       ├── WatchlistPanel
│       ├── MarketsPanel
│       ├── InfrastructurePanel
│       └── CustomPanels
└── EpistemicStatusBar
    ├── CoverageState
    ├── FreshnessState
    ├── EvidenceState
    └── SystemDegradationState
```

## Visual design principles

### Preserve

- dark operational aesthetic
- restrained semantic status colors
- fail-closed missing/unknown states
- visible degraded mode
- role-aware navigation and access
- map + reasoning + evidence identity

### Change

- reduce decorative radial/grid background dominance
- reduce number of rounded cards in a viewport
- decrease hero/marketing content inside authenticated operational surfaces
- use typography and spacing to create hierarchy before borders
- reserve accent color for active state, selection and actionable intelligence
- distinguish `unknown` from `safe`, `zero`, and `healthy` visually
- use compact labels and metadata within intelligence-dense surfaces

## Visualization strategy

AICIS should adopt a visualization grammar rather than page-by-page chart styling.

### Geospatial

- point/event markers for discrete observations
- paths/arcs for flows, migration, shipping, aviation, influence and dependency
- choropleths only for normalized comparable metrics
- uncertainty/freshness encoded separately from severity
- clustering at low zoom; semantic expansion at high zoom
- selected object always has visible provenance/freshness state

### Temporal

- lane timeline for heterogeneous event types
- sparkline for compact trends
- interval/band for uncertainty rather than unsupported single-value precision
- valid-time and knowledge-time should be inspectable for governed evidence

### Causal and relational

- graph view only where relationship semantics are explicit
- edge type and evidence strength visible
- semantic similarity must never be rendered as proven causality

### Forecasting

- probability only when calibrated/contract-valid
- outcome eligibility, sample size and evidence state adjacent to performance metrics
- prediction horizon visually explicit

## Mission presets

Do not overwhelm users with all layers. Introduce presets that configure layers, inspector defaults and panel tray while preserving a common shell:

- Global Situation
- Conflict & Security
- Humanitarian
- Climate & Disasters
- Markets & Economic Risk
- Energy & Infrastructure
- Supply Chain & Maritime
- Technology & Cyber
- Executive
- Analyst

Presets change the view, not the truth model.

## Country / entity dossier

World Monitor’s country click → dossier pattern is stronger than scattering country intelligence across independent pages. AICIS should use the same principle with deeper epistemic capabilities.

Target dossier:

- header: identity, current risk/status, freshness, evidence coverage
- left: current judgment + timeline + key signals
- right: evidence/provenance + causal factors + forecasts + decisions/outcomes
- expandable full sections for deep analysis
- selected time horizon and knowledge cutoff visible

## Mobile target

- map/canvas remains first
- bottom navigation limited to 4–5 destinations
- inspector becomes a draggable bottom sheet
- layers/search/time controls become compact modal sheets
- minimum 44 px touch targets
- no precision drag-and-drop required to perform core tasks

## Implementation tranches

### Tranche UX-0 — freeze and measure

- No production UI deployment.
- Capture current route inventory, component inventory and screenshots at desktop/tablet/mobile.
- Add visual regression and accessibility baselines before reconstruction.
- Do not remove routes yet.

### Tranche UX-1 — workspace shell

- Add `AICISWorkspaceShell` behind branch-only code.
- Introduce compact primary rail and command bar.
- Preserve existing protected-route/role semantics.
- Preserve all current pages as fallback deep links.

### Tranche UX-2 — map-first World workspace

- Promote existing planetary map to first-view canvas.
- Add layer/time/search controls.
- Add collapsible inspector.
- Move KPI/system/process details out of the primary visual hierarchy.

### Tranche UX-3 — contextual intelligence

- selected event/country/entity model
- Summary / Evidence / Timeline / Causal / Forecast / Decision / Outcome inspector tabs
- persistent spatial and time context

### Tranche UX-4 — panel tray and mission presets

- bounded panel catalog
- show/hide/collapse/fullscreen
- persisted user workspace
- mission presets
- avoid arbitrary drag requirements on mobile

### Tranche UX-5 — dossier consolidation

- country and entity dossiers
- route aliases maintained for backward compatibility
- consolidate redundant navigation entries only after usability proof

### Tranche UX-6 — visualization and accessibility proof

- visual-regression tests
- keyboard navigation
- screen-reader semantics
- color contrast
- responsive checks
- information-density checks at 1366, 1440, 1920 and 4K

## Acceptance rubric

AICIS UX reconstruction is not complete until it earns all of the following:

- first viewport communicates current world state without scroll
- primary navigation has no more than seven destinations for a normal user
- a country/signal can be explored from observation to evidence to forecast to decision without losing context
- unknown/degraded/missing states are never visually represented as healthy
- map remains usable while inspector/panels are open
- mobile core workflows do not require desktop-style dragging
- selected time horizon and freshness are visible wherever temporality matters
- accessibility and keyboard navigation pass automated and manual checks
- responsive layouts have no clipped controls or horizontal page scroll
- existing authorization boundaries are unchanged or strengthened
- no production deployment until regression, security and behavior checks pass

## Immediate next implementation step

Create the branch-only workspace shell and map-first `World` surface while keeping every existing route and operational component intact. The first code tranche should be reversible and compositional: reuse the current map, live stream, protected-route model and evidence semantics rather than rewriting them.
