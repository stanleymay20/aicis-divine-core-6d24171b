# AICIS Repository Lineage

This document records the repository-family evidence used to identify `aicis-divine-core-6d24171b` as the maintained AICIS Divine Core lineage while preserving materially different historical work.

## Canonical Divine Core repository

`stanleymay20/aicis-divine-core-6d24171b`

This is the maintained AICIS resilience, forecasting, evidence-fabric, governance and decision-support repository. New Divine Core development should target this repository unless a controlled handoff explicitly states otherwise.

## Exact Divine Core ancestry evidence

The consolidation decision is based on exact Git commit reachability rather than repository names.

### `aicis-divine-core`

- Latest substantive product head before later repository-hygiene/documentation commits: `24e20206e403cb4ed1544764acfbc7eb91fc2238` — Global Signals Engine integration.
- That exact commit is directly reachable from the canonical repository.
- Status: **historical predecessor / superseded for development / safe archive candidate**.

### `aicis-divine-core-b1d2f00f`

- Latest substantive product head before later repository-hygiene cleanup: `3a5a0ef65f4cf3eb8128ba59f60e2e1405b2b64a` — ML evaluation SLO observability and provenance layer.
- That exact commit is directly reachable from the canonical repository.
- Status: **historical snapshot / superseded for development / safe archive candidate**.

These exact ancestry probes demonstrate that the April and May Divine Core product lineages are preserved in canonical Git history.

## `AICIS-control` is a separate legacy lineage

`stanleymay20/AICIS-control` predates the Divine Core repositories and is technically distinct:

- created in March 2025;
- primarily Python/Firebase-era code;
- contains legacy cryptocurrency/exchange automation and related frontend/function assets;
- its initial commit `d1f0f9b694406107d6a864b12fd1fedd233aec65` is not reachable from the canonical Divine Core repository.

It should therefore **not** be merged into Divine Core merely to reduce repository count and should not be described as the current AICIS control plane.

Status: **legacy independent trading prototype / preserve / security remediation open**.

## AICIS-control credential-remediation boundary

A review on 12 September 2026 found hard-coded exchange credentials in the public `AICIS-control` branch tip. The current `aicis_trading.py` was repaired to use environment variables instead, but historical public credentials must still be treated as exposed until provider-side rotation/revocation is completed.

The legacy repository now contains `SECURITY_REMEDIATION.md` with the required closure steps. This security issue belongs to the legacy trading prototype and must not be conflated with the modern Divine Core security status.

## Consolidation rule

1. Preserve controlled Divine Core migrations, CI, scientific protocols, evidence ledgers, issues and PR history.
2. Do not merge legacy `AICIS-control` trading code or credential history into the modern Divine Core repository.
3. Do not archive `AICIS-control` until provider-side credential rotation/revocation and historical secret review are evidenced.
4. Archive Divine Core predecessors only after their superseded notices and any repository-specific external references have been reviewed.
5. `LINEAGE RESOLVED` identifies the maintained repository; it does not independently certify production security or scientific performance.

## Current family decision

- `aicis-divine-core-6d24171b` — **FLAGSHIP / CANONICAL / LINEAGE RESOLVED**.
- `aicis-divine-core` — **HISTORICAL PREDECESSOR / SUPERSEDED / SAFE ARCHIVE CANDIDATE**.
- `aicis-divine-core-b1d2f00f` — **HISTORICAL SNAPSHOT / SUPERSEDED / SAFE ARCHIVE CANDIDATE**.
- `AICIS-control` — **LEGACY INDEPENDENT TRADING PROTOTYPE / PRESERVE / SECURITY REMEDIATION OPEN**.
