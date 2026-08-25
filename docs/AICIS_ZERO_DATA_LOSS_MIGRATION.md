# AICIS Zero-Data-Loss Cloud Migration

## Objective

Move AICIS away from the Lovable-managed Supabase backend without losing database rows, Auth identities, Storage objects, ingestion history, cron state, Edge Functions, or operational configuration.

## Current source and target

- Authoritative source until final cutover: Lovable-managed project `psonnnuhjjskrdazrakk`.
- Independent target: `aicis-production`, project ref `qpphncfgbhizvnovzivw`.
- Target organization: `stanleymay20's Org` (`pkypvduicdrzjcrbexcy`).
- Target region: `eu-central-1`.
- The target must remain isolated from production writers until restore and parity checks pass.

## Non-negotiable rules

1. The Lovable-managed project `psonnnuhjjskrdazrakk` remains the authoritative source until final cutover.
2. Never delete, reset, truncate, recreate, repoint, or otherwise mutate the source merely to simplify migration.
3. Never point the production frontend at the target until backup + restore + verification have passed.
4. Never upload plaintext database dumps, inventories, or Storage archives to CI artifacts.
5. Secrets are recreated in target secret stores; secret values are never committed to Git or printed in logs.
6. Lovable credits/agent runs are not used for implementation.
7. A failed comparison blocks cutover.
8. Historical source-bound SQL is evidence. Preserve it; disable/rebind executable source-bound jobs on the target instead of deleting history.
9. Do not replay all historical migrations blindly into a fresh Supabase project. Supabase-managed schemas require a controlled restore strategy.
10. Quantivis infrastructure is unrelated and must never be used or modified for this migration.

## Phase 0 — Obtain source access without exposing credentials

The preservation workflows use the GitHub environment `production-data-preservation`.
Configure these **environment secrets** there; never paste their values into chat or commit them:

- `AICIS_SOURCE_DATABASE_URL` — direct PostgreSQL connection string for the source project.
- `AICIS_SOURCE_SUPABASE_URL` — source Supabase API URL.
- `AICIS_SOURCE_SERVICE_ROLE_KEY` — source server-side service-role credential used only for read-only Storage export.
- `AICIS_BACKUP_PASSPHRASE` — strong independent passphrase used to encrypt preservation artifacts.

Source credentials and target credentials are different assets. Never reuse a Quantivis credential and never expose a service-role/secret key to Vite or the browser.

## Phase 1 — Read-only source inventory and encrypted preservation

Before any restore, run `.github/workflows/data-preservation.yml` after all four source environment secrets exist.

The current workflow is expected to:

1. fail closed if any required source secret is absent;
2. run `scripts/aicis-source-inventory.sh` using read-only SQL;
3. create PostgreSQL dumps with `scripts/aicis-backup.sh`;
4. validate the dump with `pg_restore` tooling;
5. mirror actual Storage object bytes with `scripts/aicis-storage-backup.mjs`;
6. encrypt inventory, database backup, and Storage archive before upload;
7. checksum encrypted artifacts;
8. delete plaintext production payloads before artifact upload.

Capture and preserve at minimum:

- source identity, PostgreSQL version, database size, schemas and extensions;
- every visible table and exact row count;
- `auth.users` count and identity relationships;
- Storage buckets, objects, metadata, byte sizes and checksums;
- functions/triggers/RLS/grants;
- migration history;
- cron/pg_cron inventory, including source-bound URLs;
- provider freshness state and ingestion history;
- important checksums for later parity verification.

Do not proceed as though a backup exists if this workflow has not completed successfully and produced validated encrypted artifacts.

## Phase 2 — Independent target baseline

The independent target already exists as `aicis-production` (`qpphncfgbhizvnovzivw`) in `eu-central-1`.

Before restore, verify live that it is `ACTIVE_HEALTHY` and record its baseline. A newly created clean target is expected to have no AICIS public tables, users, buckets, or objects.

Do not change production frontend environment variables yet.

## Phase 3 — Controlled restore

Do **not** blindly restore Supabase-managed internals or replay all historical migrations.

Restore by category:

1. **Extensions and custom/application schemas** — match required extension capabilities first, then restore schema and data while preserving IDs and timestamps.
2. **Auth** — use the safest currently supported Supabase migration procedure. Preserve user IDs and account relationships where supported. Do not promise existing session/JWT continuity; reauthentication is acceptable if identities and authentication mechanisms remain intact.
3. **Storage metadata** — restore carefully without corrupting target-managed Storage internals.
4. **Storage object bytes** — copy the actual object payloads, not just `storage.objects` rows.
5. **Edge Functions** — deploy only after reviewing each function's intended JWT/custom-auth policy.
6. **Secrets** — recreate target runtime/provider secrets securely; do not copy obsolete Lovable credentials.
7. **Auth configuration** — reproduce required provider settings and redirect URLs.
8. **Cron/schedulers** — keep restored source-bound schedules disabled until explicitly rebound to the target.
9. **External callbacks/webhooks** — repoint only after target validation.

## Phase 4 — Target cron isolation

Historical source migrations contain hard-coded references to `psonnnuhjjskrdazrakk`. Restoring them unchanged can create split-brain AICIS.

Use `migration/target/001_rebind_pipeline_cron.sql` only on the independent target and only after its required target Vault values are present:

- `aicis_project_url`
- `aicis_publishable_key`
- `aicis_cron_secret`

`aicis_cron_secret` must match the target Edge Function secret `CRON_SECRET`. The publishable key is an API key and belongs in the `apikey` header; it must not be treated as a Bearer JWT.

The target-only migration disables restored cron commands that still contain the source ref and fails closed if an active source-bound cron job remains. Only explicitly audited schedules should be re-enabled.

## Phase 5 — Verification gate

Run `scripts/aicis-migration-verify.sh` with:

- `AICIS_SOURCE_DATABASE_URL`
- `AICIS_TARGET_DATABASE_URL`

The verifier must show matching visible table sets and exact row counts. Supplement it with checks that row counts alone cannot prove.

Required gates include:

### Database
- source table set = target table set for the intended migrated schemas;
- exact row counts match;
- critical IDs and timestamps are preserved;
- critical checksums match.

### Auth
- source user count = target user count;
- user IDs/identity relationships are intact;
- login, protected routes, refresh behavior and logout work on target.

### Storage
- bucket count matches;
- object count matches;
- total/critical bytes match;
- critical object checksums match;
- read/write policies work as intended.

### Functions and security
- every required runtime function is deployed;
- `verify_jwt`/custom authentication matches intended callers;
- privileged functions are not anonymously callable;
- provider-neutral AI calls work without Lovable;
- target security/performance advisors are reviewed.

### Cron and bindings
- no active target cron command points to `psonnnuhjjskrdazrakk`;
- `scripts/audit-source-project-bindings.sh --strict` finds no executable source binding;
- historical migration/control references may remain as audit evidence;
- `scripts/assert-lovable-pause-ready.sh qpphncfgbhizvnovzivw` passes only after `supabase/config.toml` is intentionally cut over.

## Phase 6 — Shadow validation and delta strategy

A single T0 snapshot is not zero-data-loss while the source continues receiving writes.

After the initial target restore:

- keep production writers on the source;
- validate target reads/functions with target writers disabled or safely isolated;
- determine and test a final delta/incremental sync strategy;
- compare provider/domain counts and freshness;
- avoid duplicate external side effects from running both source and target writers.

Immediately before cutover:

1. prevent or minimize new source writes for a controlled final window;
2. capture the final delta/checkpoint;
3. apply it to target;
4. run parity again;
5. only then enable target writers.

Do not claim zero-data-loss unless this final-delta handling is proven.

## Phase 7 — Frontend and runtime cutover

The Netlify frontend expects exactly:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never expose a service-role/secret key to the frontend.

Only after target restore, Auth, Storage, functions and parity pass:

1. configure Netlify production environment values for `qpphncfgbhizvnovzivw`;
2. update target Auth redirect URLs/callbacks;
3. deploy current GitHub `main`;
4. verify browser/network traffic contains no operational source or Lovable endpoints;
5. update `supabase/config.toml` project ID to `qpphncfgbhizvnovzivw` and commit it to `main`;
6. run static and live pause-readiness gates.

## Phase 8 — Production write and provider-freshness proof

After runtime switches to the target, create or observe a controlled new production event.

Prove:

- the event appears on the target;
- the event does **not** appear on the source;
- downstream target pipelines process it;
- each active provider creates fresh target records on its expected cadence;
- target logs contain the expected executions/errors/retries.

There must be exactly one active production writer after cutover.

## Phase 9 — Lovable-pause test

Do not delete the source. Simulate source unavailability operationally and verify AICIS without relying on it:

- frontend loads with no source/Lovable calls;
- Auth login/session/protected routes/logout work;
- database reads/writes and RLS work;
- Storage reads/writes work where applicable;
- critical Edge Functions run on target;
- target cron jobs execute;
- provider-neutral AI works;
- active ingestion providers remain fresh;
- decision/intelligence pipelines continue;
- target logs populate;
- no source writes occur.

AICIS is independent only when it is truthful to say: **if Lovable Cloud disappeared now, AICIS would continue operating.**

## Phase 10 — Post-cutover disaster recovery

Keep the Lovable source intact as a historical fallback during the observation period; do not delete it merely because the UI works.

Establish target production recovery with:

- Supabase backups appropriate to the Pro plan;
- encrypted independent database backup;
- Storage object preservation;
- periodic restore drills;
- documented RPO/RTO;
- credentials recovery procedure;
- provider secret-name inventory;
- database-size and backup-health monitoring.

## Rollback

If a critical target validation fails after cutover:

- disable target writers;
- restore frontend routing to the known-good source if the source is still available;
- re-enable source writers only if they were deliberately disabled;
- investigate the mismatch.

Never attempt rollback by overwriting the known-good source with target data.
