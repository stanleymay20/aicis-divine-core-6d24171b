# AICIS Branch Reconciliation — 2026-09-29

Deployment authority: `main`

## Reconciled into main history

The following branch heads were reconciled into `main` using a history-only merge that retained the current `main` tree because their work was already present, byte-identical, or superseded by newer implementations:

- `chore/data-migration-integrity-gates-v1`
- `chore/migration-staging-safety-v1`
- `feat/evidence-fabric-v1`
- `feat/scientific-forecasting-protocol-v1`
- `feat/sovereign-ai-gateway-v1`
- `feat/sovereign-ai-runtime-v1`
- `feat/sovereign-artifact-lock-v1`
- `feat/world-model-data-foundation-v1`
- `hardening/auth-10-10`
- `lovable-sync`
- `lovable-sync-1790543502`

Reconciliation merge:

`2afce531452b489a2dcdbebe846e3ff51d638cf9`

After reconciliation, each branch above reports `ahead_by: 0` relative to `main`.

## Intentionally not merged

### feat/forecast-ledger-migration-v1

This branch remains quarantined because it contains:

- `supabase/migrations/20260902043532_forecast_task_registry_ledgers_v1.sql`
- migration-generation provenance
- migration-provenance tests

Its own provenance record states:

- `status: generated_not_deployed`
- `applied_to_supabase: false`
- `applied_to_aicis_production: false`

The current main repository intentionally keeps the scientific forecast ledger as reviewed candidate/hardening SQL and explicitly states that no production migration is introduced by that candidate. Merging the quarantined migration merely to clean branch history could alter database-deployment behavior and is therefore prohibited until a separate migration safety review approves it.

### Dependabot branches

Dependabot branches remain governed by their existing open PRs and are not branch-reconciled into main automatically. They include major or grouped dependency/toolchain updates that require their own CI and compatibility review.

## Lovable deployment rule

Completed application work must land on `main`.

Branch history alone is not a Lovable deployment requirement. Lovable deploys the current `main` tree. This reconciliation record intentionally changes the main tree so the post-reconciliation state produces a normal deployment signal without modifying application runtime behavior.
