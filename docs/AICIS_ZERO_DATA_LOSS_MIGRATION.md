# AICIS Zero-Data-Loss Cloud Migration

## Objective

Move AICIS away from Lovable-managed Cloud/Supabase without losing database rows, Auth identities, Storage objects, ingestion history, cron state, Edge Functions, or operational configuration.

## Non-negotiable rules

1. The Lovable-managed project `psonnnuhjjskrdazrakk` remains the authoritative source until final cutover.
2. Never delete, reset, truncate, recreate, or repoint the source during migration.
3. Never point the production frontend at the target until backup + restore + verification have passed.
4. Never upload plaintext database dumps or Storage archives to CI artifacts.
5. Secrets are recreated in the target secret store; secret values are never committed to Git.
6. Lovable credits/agent runs are not used for implementation.
7. A failed comparison blocks cutover.

## Phase 0 — Source inventory

Capture and preserve:

- source project ref and region
- PostgreSQL version/extensions
- all schemas/tables and exact row counts
- `auth.users` count and provider configuration
- Storage buckets, object counts, and object bytes
- migration history
- RLS policies, functions, triggers, grants
- Edge Function inventory and JWT settings
- cron/pg_cron jobs and schedules
- Vault/secret names (never print values)
- ingestion provider schedules and latest-success timestamps
- webhook endpoints and external provider callbacks

## Phase 1 — Encrypted source snapshot

Run `.github/workflows/data-preservation.yml` only after these GitHub secrets exist:

- `AICIS_DATABASE_URL`
- `AICIS_BACKUP_PASSPHRASE`
- `AICIS_SUPABASE_URL`
- `AICIS_SERVICE_ROLE_KEY`

The workflow must produce encrypted database + schema material and encrypted Storage object bytes. Validate checksums before proceeding.

## Phase 2 — Create independent target

Create `aicis-production` in the intended independent Supabase organization. Prefer the same geographic region as the source unless there is a deliberate residency decision.

Do not change frontend environment variables yet.

## Phase 3 — Restore

Restore in this order:

1. extensions required by schema
2. schema/functions/types
3. row data, including Auth/Storage metadata where supported
4. Storage object bytes
5. Edge Functions
6. secrets
7. Auth provider configuration and redirect URLs
8. cron jobs/schedulers
9. webhooks/external callbacks

## Phase 4 — Verification gate

Run `scripts/aicis-migration-verify.sh` with:

- `AICIS_SOURCE_DATABASE_URL`
- `AICIS_TARGET_DATABASE_URL`

The verifier must show an exact table set and row-count match. Independently verify Storage object bytes from the encrypted Storage manifest.

Additional cutover gates:

- Auth sign-in works on target
- representative protected queries pass RLS correctly
- all required Edge Functions are deployed
- cron jobs exist but are initially disabled or isolated from duplicate side effects
- provider credentials exist in target
- provider freshness checks pass
- no critical function still requires Lovable Cloud or `ai.gateway.lovable.dev`

## Phase 5 — Shadow validation

Before production cutover, run the target in read-only/shadow mode where possible. Compare:

- provider ingestion freshness
- record counts by provider/domain
- prediction/brief generation outputs
- health telemetry
- auth behavior
- Storage reads

Avoid running duplicate write-producing schedules against both source and target unless they are explicitly idempotent.

## Phase 6 — Cutover

Only after all gates pass:

1. pause source ingestion writers briefly if needed
2. take a final encrypted delta/final snapshot
3. restore/verify final delta
4. switch frontend environment variables to target Supabase
5. update Auth redirect URLs and external callbacks
6. enable target cron/ingestion
7. disable source writers
8. verify live provider freshness
9. monitor errors and data divergence

## Phase 7 — Post-cutover observation

Keep the Lovable source intact and read-only during the observation window. Do not delete it merely because the frontend works.

Recommended exit criteria before source retirement:

- repeated successful backups of target
- verified restore drill
- no source-target divergence at final checkpoint
- all providers fresh within SLA
- Auth/Storage/Edge Function checks green
- no Lovable runtime dependency in critical paths

## Rollback

If any critical target validation fails after cutover:

- disable target writers
- restore frontend routing to source
- re-enable source writers
- investigate mismatch

Never attempt a rollback by overwriting the known-good source with target data.
