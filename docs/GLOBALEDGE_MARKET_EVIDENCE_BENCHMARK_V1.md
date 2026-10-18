# Global Business / globalEDGE Benchmark and Market Evidence Slice v1

Status: controlled, repo-only research/implementation candidate (not live certified)
Date: 2026-10-18
North Star: `docs/AICIS_NORTH_STAR_CONTINUATION_V1.md`
Follow-up: Issue #48 is still a separate live-runtime proof gate. No Lovable actions.

## Why this exists

The user requested deep comparison of Michigan State University's globalEDGE™ with AICIS and the best justified implementation in **GitHub, not Lovable**. The product's first commercial wedge remains **operational resilience/continuity**, not a second general business-statistics platform.

globalEDGE is a research benchmark, **not an AICIS partner, data provider or licensed feed**. No endorsement or affiliation is asserted.

## Directly verified globalEDGE references (2026-10-18 access)

- Country comparator: https://globaledge.msu.edu/comparator/ — World Bank API attribution; user can choose at most 20 countries and 5 indicators, with explicit "latest available" and specified-year semantics.
- Global Insights: https://globaledge.msu.edu/global-insights — country, trade bloc, economic classification, industry and U.S. state research.
- Tools and Data: https://globaledge.msu.edu/tools-and-data — market potential, DIBS, comparator, rankings, decision diagnostics.
- General MPI: https://globaledge.msu.edu/mpi — the accessible page is marked **2022**, published February 2023; uses eight weighted dimensions. **Do not describe that edition as a current 2026 scoring standard**.
- Industry MPI: https://globaledge.msu.edu/industry-mpi — six dimensions, export-market screening (not investment selection), and expressly **not a forecast** or sufficient as a single decision source.
- DIBS: https://globaledge.msu.edu/tools-and-data/dibs — explicitly for academic **non-commercial** use, with registration and institutional eligibility requirements; do not ingest into commercial AICIS absent separate written rights.

Research references are documentation, **not automated ingestion endpoints**.

## Feature-by-feature diligence

| Research capability | globalEDGE benchmark | AICIS existing repo | Correct response |
| --- | --- | --- | --- |
| Country profiles | Country insights covering >200 countries | Existing `country_profiles`, deep dive, World entity | Reuse; verify live data coverage, not new schema |
| Multi-country indicator comparison | Explicit period selection, units, World Bank provenance | Normalized metrics + Risk Atlas comparisons, but Atlas primarily shows risk snapshots | **Implement comparison of existing real observations with year/unit/provider gate** |
| Country/industry market potential screening | Weighted diagnostic index with explicit scope and methodological warning | AICIS risk/opportunity data and several candidate scoring pathways | Do **not** copy weights, invent MPI, or market-entry recommendation |
| Trade blocs / industries | Curated reference guides, classifications | Existing opportunities/trade evidence components | Catalog/provenance mapping first; do not spawn parallel tools |
| Export-entry support | HS/trade/logistics guidance | Existing landed-cost and transaction evidence workflows | Extend through validated existing contracts, not loose generative claims |
| DIBS time-series data | Access limited to eligible research use | Existing provider adapters and `normalized_metrics` | **No scraping, redistribution or commercial data import** |
| Scenario and forecasting | MPI explicitly nonforecasting | AICIS governed scientific protocol | Leave forecast as separate registered prospective task |
| Country risk | Screened and weighted context | Country performance snapshots | Never equate arbitrary risk score with a calibrated probability |

## Implemented first vertical slice

Existing Risk Atlas accepts comparisons such as `compare Nigeria and Kenya on governance`.

When a verified ISO3 pair is selected, `MarketEvidenceComparisonV1` reads only existing `normalized_metrics` using the authenticated user's existing Supabase RLS. It does not write, create tables, call globalEDGE, or deploy a new backend.

Contract files:
- `src/lib/market-evidence-comparator-v1.mjs` — deterministic observation join (domain, metric, exact period, unit and provider).
- `src/hooks/useMarketEvidenceComparisonV1.ts` — bounded read-only samples of up to 250 metrics **per country**, explicitly not exhaustive.
- `src/components/risk-atlas/MarketEvidenceComparisonV1.tsx` — annotated, provenance-aware comparison in existing Risk Atlas.
- `tests/market-evidence-comparator-v1.test.mjs` — required deterministic truth-floor regression tests.
- `.github/workflows/ci.yml` — mandatory gate for tests.

Comparison output states: `comparable`, `not_aligned`, `missing_country`, `invalid_evidence`, `ambiguous`. Only unambiguous pairs with a shared domain/indicator/period/provider/unit display side-by-side numeric values. Zero is a valid observed value; nonfinite and provider-less observations do not qualify. Multiple matching rows without record-level disambiguation remain ambiguous.

**Do not interpret this as:** globally complete World Bank coverage, data freshness certification, statistical significance, data licensing approval, GDP / trade / demand forecast, estimated market share, relative market attractiveness, source independence, or investment recommendation.

Queries can fail from absent optional live columns, RLS, empty feeds or runtime outages. Fail visibly. Sampling, period mismatch, and inconsistent provider semantics are evidence gaps; never invent values. Latest common year is not necessarily latest individually available year. The comparator must not silently substitute mismatched vintages.

## Non-goals / restricted changes

- Do not alter first commercial wedge or change the North Star.
- Do not add a market-attractiveness score, ranking, weights, or globalEDGE name/logo to the product.
- Do not ingest globalEDGE DIBS under its academic non-commercial terms.
- Do not scrape data or copy proprietary indices/methodology into an unlicensed commercial feed.
- Do not deploy data migrations or change auth/RLS.
- Do not merge or deploy quarantined forecast PR #31.
- Do not turn this observational comparator into a scientifically validated forecast, proof of causality or operational release certification.

## Validation and promotion gates

1. Exact-head tests, lint, typecheck, build, CodeQL, auth-boundary and Security DB behavioral workflows must pass before merge.
2. Live read access must be separately verified on the **maintained** runtime for at least two valid country ISO3s; document query success/error, schema support, record count, sampling cap, latency and RLS behavior. **This has not been shown by CI**.
3. Verify there are actual same-domain/vintage/source/unit indicator pairs, plus at least one explicit mismatched-period and missingness case.
4. Verify the UI reports unavailable data and does not portray empty or sampled rows as a full-country profile.
5. Confirm provenance and source licensing per original provider before broader commercial use.
6. For any future market-entry *decision* candidate: preregister product/HS code, target user, entry mode, sector-specific indicators, data time, weights (if justified), counterfactuals/alternatives, permission, affordability and human sign-off. Ranking must remain clearly separate from forecast.

## Next controlled steps for future bots

1. Inspect the current `main`, PRs and CI before touching data/route code.
2. Read `AGENTS.md`, North Star, this contract, Situation contract and trade/landed-cost contracts.
3. Resolve issue #48 live-data gate independently; no Situation persistence before that proof.
4. Validate the comparative indicator slice with maintained source data and RLS.
5. Only after this evidence, consider documented time-series selection and user-selected indicators (subject to defensible query coverage), then a bounded sector-specific export/market-entry research worksheet. **No invented MPI, no backfilled probabilities**.
6. Record exact code SHA, timestamp, environment, sources, evidence gaps and reviewer before any promotion.

The strategic lesson from globalEDGE is **transparent definitions and reproducible cross-country comparison**, not copying or overclaiming a ranking.
