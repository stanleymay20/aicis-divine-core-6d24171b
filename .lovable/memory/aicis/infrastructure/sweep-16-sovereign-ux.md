---
name: Sweep 16 — Sovereign UX & Trust Communication
description: SovereignHeader, TrustFooter, CitationChip, ConfidenceBadge, SourceDiversityMeter, ExecutiveModeToggle, MinisterBrief at /brief/today, i18n + vocabulary scaffolds
type: feature
---

## Shipped

**Sovereign chrome (every authenticated page)**
- `SovereignHeader` — classification strip (UNCLASSIFIED // FOR OFFICIAL USE), platform name, mode badge, live telemetry chips: Ledger count, Sources (Tier-1 publishers), Last Signed (relative), Citations Active. Mounted in `AICISLayout` above `AICISTopBar`.
- `TrustFooter` — quiet strip with Ledger Verified · Federation Signed · Residency Resources · Authority Sources plus Non-Surveillance Guarantee. Mounted at bottom of `<main>`.
- Both pull from `useSovereignStats()` hook (`src/lib/sovereign/useSovereignStats.ts`), 60s stale, 120s refetch.

**Minister Brief — `/brief/today`** (`src/pages/MinisterBrief.tsx`)
- Classification banner top + bottom. Executive Summary, Top Developments, Emerging Risks, Recommended Actions, Source Appendix, Federation Signature.
- Print / Export PDF (window.print with print CSS) / Share Secure Link buttons.
- ViewModeToggle (Executive ↔ Analyst).

**Citation visibility primitives**
- `CitationChip` + `CitationChipList` — tier-colored chips (T1 emerald, T2 blue, T3+ neutral), confidence weight, optional URL link, "⚠ No citations — opinion only" empty state.
- `SourceDiversityMeter` — counts unique publishers + tier breadth → HIGH/MEDIUM/LOW.
- `ConfidenceBadge` — HIGH/MEDIUM/LOW + percentage, replaces raw "confidence = 0.84".

**Executive Mode**
- `ExecutiveModeContext` + `ViewModeToggle`. Persisted in localStorage. Sets `data-view-mode` on `<html>` for future CSS hooks.
- `humanize()` in `src/lib/humanize-vocab.ts` swaps technical terms ("ml inference" → "Intelligence Assessment", "z-score" → "Confidence Deviation", table names → readable labels) in executive mode only.

**i18n scaffold**
- `src/lib/i18n/index.ts` with `t(key, fallback)`, `getLocale`, `setLocale`. Supported: en, fr, de, it, ja (latter four are empty stubs — fall back to en).
- `src/lib/i18n/en.ts` seeds sovereign chrome + brief strings.

## Wired in App.tsx
- Added `ExecutiveModeProvider` wrapping `IntelligenceMemoryProvider`.
- Added route: `/brief/today` (Protected, lazy-loaded).

## Verified
- All MinisterBrief queries match real DB columns: `aicis_early_warnings.{iso3,event_type,subtype,severity,recommended_next_action,first_detected_at}`, `risk_ranking_predictions.{country_iso3,domain,risk_probability,rank_position,horizon_days}`, `risk_action_recommendations.{intervention_title,intervention_type,urgency_window,estimated_roi_eur,rationale_md,status}`.
- Citation authority_tier resolved via join through `source_authority_registry.publisher_key`.

## Deferred to Sweep 17
- Real fr/de/it/ja translations (machine seed + human review).
- Decision Timeline component (past 24h/7d/30d chronology view).
- PDF export via headless render (current = browser print).
- Vocabulary humanize pass across existing pages (only applied in MinisterBrief so far).
- Classification level switching by deployment mode (currently hard-coded UNCLASSIFIED // FOUO).
- Federation signature actually signing the Minister Brief payload (UI shows the metadata; signing call wired in Sweep 18).
