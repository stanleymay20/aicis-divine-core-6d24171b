---
name: Sweep #14 Executive UX & Maintainability
description: Decomposed ForecastValidation (530→125 LOC) and Accumulation (469→75 LOC) into component folders. Replaced random sparklines and hardcoded "128.7M At-Risk Pop." in AnalystDashboard with live data derived from event series and risk_ranking_predictions (countries_at_risk ≥75 score). Swapped ad-hoc Loader2 spinners in LearningLoop & RiskRanking data panels for PanelSkeleton. Action-button spinners (refresh.isPending) intentionally kept as Loader2.
type: feature
---

## Outcome
- src/components/forecast-validation/{atoms,queries,AccumulationMonitor,MatchPolicyCoverage,MatchQualityAudit,ReadinessAndGaps,BreakdownTables}.tsx
- src/components/accumulation/{types,atoms,queries,DomainCard,ProvidersTab,StorageTab}.tsx
- Analyst KPIs now include `countriesAtRisk` (distinct ISO3 with risk_probability ≥ 0.75) and sparklines use 16-hour tail of normalized_events buckets per category.
- React Query unified loadAll → useForecastValidation (stale 30s) + useAccumulationData (stale 60s).

## Standard
- Data-loading skeletons must use `<PanelSkeleton variant="..." rows={n} header={false} />`. Reserve `Loader2` exclusively for in-flight action/mutation buttons.
- Page files target ≤300 LOC; extract panel logic into `src/components/<page-name>/` folders with `queries.ts` + `atoms.tsx` + one file per major card.
- Never ship hardcoded headline numbers ("128.7M") or `Math.random()` sparklines — derive from live tables.
