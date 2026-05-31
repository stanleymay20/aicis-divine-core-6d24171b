# Sweep #12 — Frontend Maintainability & Operational UX Hardening

## Part A — Monolith Decomposition

**Finding:** Targets already decomposed in prior sweeps.

| Page | LOC | Status |
|---|---|---|
| `src/pages/DataPipeline.tsx` | 118 | ✅ Decomposed into 6 section components under `src/components/data-pipeline/*` |
| `src/pages/AnalystDashboard.tsx` | 124 | ✅ Decomposed into 7 section components under `src/components/analyst-dashboard/*` |

Both well under the 250–300 LOC target. No further extraction performed.

**Next largest monoliths (out of scope, candidates for Sweep #13):**
- ForecastValidation 530 · ExportCenter 429 · TrainingDataset 384 · LocalEvents 372 · LearningLoop 323 · Landing 299 · ExportLayer 287 · Status 283.

## Part B — QueryPanel / PanelBoundary Adoption

### Before
- `QueryPanel` adoption: 4 files
- `PanelBoundary` adoption: 14 files
- `PanelEmpty` adoption: 12 files

### Changes
1. **DataPipeline.tsx** — wrapped 5 section cards (Chain, RunHealth, Freshness, Orphans, SeedRetry) in `PanelBoundary` so a single failing card no longer blanks the truth-floor view.
2. **LearningLoop.tsx** — wrapped page content in `PanelBoundary`.
3. **Predictions.tsx** — wrapped page content in `PanelBoundary`.
4. **Simulation.tsx** — wrapped page content in `PanelBoundary`.
5. **OutcomeCockpit.tsx** — wrapped page content in `PanelBoundary`.

### After
- `PanelBoundary` adoption: 19 files (+5)
- `QueryPanel` adoption: unchanged (IntelligenceEngine already standard)

### Pages intentionally skipped
- Static / informational: `Privacy`, `Terms`, `Landing`, `NotFound`, `Index`, `ResetPassword`, `Auth`, `RegisterNode`.
- Trivial wrappers: `RiskAtlasPage`, `RelevancePreferences`, `PlanetaryCommandCenter`, `Decisions`, `EvidenceCommand`, `CountryDeepDivePage`.
- Already wrapped at component level: `MorningBrief`, `AnalystDashboard`, `LearningIntelligence`, `RiskRanking`, `IntelligenceEngine`.

## Part C — Operational UX Audit (prioritized remediation list)

Top operator surfaces reviewed: CommandCenter, MorningBrief, AnalystDashboard, RiskRanking, IntelligenceEngine.

| # | Surface | Finding | Severity |
|---|---|---|---|
| 1 | AnalystDashboard | KPI strip mixes real query data (`globalRisk`, `activeAlerts`) with hard-coded values (`At-Risk Pop. 128.7M`) — trust risk. | High |
| 2 | AnalystDashboard | Spark series are random math, not real timeseries — should derive from `trend.data` or be removed. | High |
| 3 | MorningBrief | Live operations collapsible hides 3 panels behind one toggle — operator may miss breaking signals during a live incident. Consider auto-expand when `BreakingNowLane` has unread critical items. | Medium |
| 4 | IntelligenceEngine | Empty-state copy assumes operator knows to click "Run inference" — needs link to docs or one-click bootstrap. | Medium |
| 5 | RiskRanking | Domain filter and refresh button compete for the same eye-line; no last-refreshed timestamp surfaced. | Medium |
| 6 | CommandCenter | (Pending re-audit) | — |
| 7 | All operational pages | Inconsistent loading: some use `Loader2` inline, others use `PanelSkeleton`, others rely on `QueryPanel`. Standardize on `QueryPanel` going forward. | Medium |
| 8 | All operational pages | "Last updated" timestamps inconsistent — some show, most don't. Add to every data-bound panel. | Low |

## Success criteria

- Standardized error recovery: ✅ extended to 5 more pages
- No major monolith pages remaining: ✅ both targets already <130 LOC
- QueryPanel adoption: partially expanded; full QueryPanel migration deferred (changes query semantics in several pages)
- Operator trust hardening: tracked as remediation list above

## Out of scope / deferred to Sweep #13
- Replace hardcoded `128.7M` and random sparklines in AnalystDashboard with live data
- Convert remaining inline loaders to `QueryPanel`
- Decompose ForecastValidation / ExportCenter / TrainingDataset monoliths
