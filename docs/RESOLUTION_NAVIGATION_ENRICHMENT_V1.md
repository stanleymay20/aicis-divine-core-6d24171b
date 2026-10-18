# Resolution Navigation, Snapshot Fallback & Enrichment Batching v1

Status: repo-only candidate — verification must be referenced by exact commit.
Date: 2026-10-18. Controlled by `AGENTS.md`, `docs/AICIS_NORTH_STAR_CONTINUATION_V1.md` and `docs/SITUATION_READ_MODEL_V1.md`.

## Requirements implemented

1. **Snapshot date fallback** in `GlobalOverview.tsx`: latest available snapshot date from `country_performance_snapshots`, not a hard-coded current UTC date. Errors are surfaced separately from no data. UI states the exact vintage and warns that the 200-row / 20-country display is a sample, not exhaustive coverage. `CountryDrilldown.tsx` likewise uses its country-specific latest snapshot date and does not report zero risk when no data exists.
2. **Direct navigations**: World has Resolution Explorer and selected-country deep dive buttons, and Global Overview country rows include a separate Country Profile link. Navigation lives in `src/lib/country-navigation-v1.mjs` with ISO3 validation.
3. **Geographic badges**: Morning Brief featured/secondary signals and Situations show verified-identity country links to `/deepdive/:iso3` and `/resolution?country=ISO3`. Region labels link via `/resolution?country=ISO3&regionName=...` **only when exactly one country is identified**. On arrival the explorer queries `admin_regions` with country and exact region name, auto-opening only for a unique match. Missing or ambiguous names stay on the country view with an explanation. A text region name is never treated as an ID.
4. **Bounded enrichment**: `enrich-global-signals` fetches up to 12 pending signals, conditionally claims only rows still pending at the original attempt count, and classifies verified four-signal chunks in waves of at most two parallel requests. Chunk failures release only claimed members and count as errors. No fabricated classified values, retries, model identities or source independence.
5. **Verification**: `tests/resolution-navigation-enrichment-v1.test.mjs` checks routes, snapshot policy, valid ISO3 paths, ambiguous region guard, bounded batches, unique per-chunk classifier indices, claim conditional guards, and fail-closed batch isolation. This test is a required CI job. Full lint, typecheck, build, CodeQL, auth boundary and DB behavioral tests remain mandatory.

## Truth and safety constraints

- Enrichment scores are evidence-constrained classifier screens, **not** scientifically calibrated probability or causal proof.
- Only the controlled `requireAdminOrTrustedWorker` pathway can call the Edge Function. No role, auth, RLS, schema or migration changes.
- Concurrent enrichment requests may fetch the same candidates; only a successfully updated pending row is processed. Losing a claim means skipping it.
- Per-chunk model provider and model version are recorded rather than claiming a single provider when parallel requests differ. Worker errors are logged. A failed classification never gets synthetic scores.
- The `10-minute` stuck-enriching recovery from the existing runtime is retained; timeout/retry budgets must be validated in staging before increasing parallelism further.
- Geographic badge navigation is an **investigation route**, not proof of a confirmed administrative location or corroborated source.
- The country comparison module and Situation v1 science/security gates are unaffected.
- PR #31 forecast ledger remains quarantined.

## End-to-end verification matrix

| Gate | How to verify | Evidence status |
| --- | --- | --- |
| Unit/contract | `node --test tests/resolution-navigation-enrichment-v1.test.mjs` | Deterministic CI |
| Types/build | `bun run typecheck` and `bun run build` | GitHub CI |
| Safety | Auth boundary, DB behavioral, CodeQL, exact-head CI | GitHub Actions |
| Browser navigation | Authenticated home → World → Resolution → country; Brief country/region badges; Situations badges; refresh deep links | Requires maintained deployed preview with login |
| Snapshot runtime | Confirm no today rows, latest archived snapshot present and displays data (not artificial score); empty/errors distinct | Requires maintained data access |
| Region identification | Unique admin match opens; zero/ambiguous results present notice instead of arbitrary region | Requires maintained data + browser |
| Concurrent worker | Two workers competing for same pending rows; check each claimed once and attempt counters; mixed success/failure with retries, log timing and costs | Requires non-production live-equivalent worker test |
| E2E classification | Submit controlled signal fixtures and independently inspect routing, records, audit log, no fabrication | Requires approved isolated environment and provider quota |

**Do not call browser E2E passed or production rollout safe merely because code, unit tests or build pass.** No Lovable interaction and no production backend invocation was authorized or performed as part of this work.

## Handoff to any future bot

Start with `AGENTS.md`, this contract, North Star and Situation contract. Inspect current Git HEAD and workflow results. Complete the maintained-runtime matrix, document exact deployment SHA, role, UTC timestamp, counts, source freshness and error states. Keep staging tests non-destructive and preserve source data, authorization, governance and CI. Only promote batch changes after measuring real provider latency, quotas, retries and duplicates.
