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
2. Never delete, reset, truncate, recreate, repoint, pause, or otherwise mutate the source merely to simplify migration.
3. Never point the production frontend at the target until backup + restore + verification have passed.
4. Never upload plaintext database dumps, inventories, or Storage archives to public GitHub or ordinary CI artifacts.
5. Secrets are recreated in target secret stores; secret values are never committed to Git or printed in logs.
6. Lovable credits/agent runs are not used for implementation or migration.
7. A failed comparison blocks cutover.
8. Historical source-bound SQL is evidence. Preserve it; disable/rebind executable source-bound jobs on the target instead of deleting history.
9. Do not replay all historical migrations blindly into a fresh Supabase project. Supabase-managed schemas require a controlled restore strategy.
10. Quantivis infrastructure is unrelated and must never be used or modified for this migration.

## Phase 0 — Emergency Lovable Cloud preservation

A Lovable Cloud backend does not behave like a Supabase project owned directly in the user's Supabase organization. Do not make the migration wait for a direct source database URL or service-role key that Lovable Cloud may not expose.

### Primary T0 preservation path: official Lovable export

Use the Lovable UI manually. This does not require using Lovable's AI builder.

1. Open the AICIS project.
2. Go to **Cloud → Overview → Advanced settings**.
3. Under **Export project data**, choose **Export data**.
4. On the **Database** card choose **Export → Start export**.
5. When Lovable reports that the export is ready, download the database export from **Cloud → Storage**.
6. Separately download the actual Storage files/buckets from **Cloud → Storage**.
7. Preserve the downloaded artifacts outside the Lovable project itself and compute checksums before any restore.

Current Lovable constraints that affect the migration plan:

- the database export contains database structure and data;
- the database export is limited to 5 GB;
- a new export can be requested only once per 24 hours;
- Storage object bytes are separate from the database export;
- Edge Function source code and secret values are not part of the database export;
- usable user passwords are not exported, so password reset/reauthentication must be planned unless the actual export provides a supported equivalent;
- never pause or remove Lovable Cloud before both database and Storage preservation are complete.

The first completed export is the T0 preservation checkpoint. It protects accumulated intelligence even while the live source remains authoritative.

### Fallback path only: direct-access preservation workflow

The repository also contains `.github/workflows/data-preservation.yml`, `scripts/aicis-source-inventory.sh`, `scripts/aicis-backup.sh`, and `scripts/aicis-storage-backup.mjs`.

Use that path **only if legitimate direct source credentials become available without Lovable credits or source mutation**. Its environment-secret names are:

- `AICIS_SOURCE_DATABASE_URL`
- `AICIS_SOURCE_SUPABASE_URL`
- `AICIS_SOURCE_SERVICE_ROLE_KEY`
- `AICIS_BACKUP_PASSPHRASE`

Do not ask for these values in chat. The workflow must fail closed when they are absent.

## Phase 1 — Validate the exported preservation artifacts

Before restoring anything, validate the downloaded database export without printing row contents.

Use `scripts/aicis-lovable-export-validate.sh <database-export-path> [output-directory]`.

The validator must record at minimum:

- source export filename and byte size;
- SHA-256 checksum;
- detected archive/file type;
- whether `pg_restore --list` can parse it as a PostgreSQL archive;
- a schema/object manifest when the format supports it;
- warnings when the format requires a different restore path.

For Storage, create a separate file manifest containing relative path, byte size and SHA-256 for every downloaded object. Database preservation and Storage preservation are both required.

Do not claim T0 preservation PASS until the database artifact and Storage payloads have been downloaded and checksummed.

## Phase 2 — Build source inventory from the export

The official export becomes the primary source inventory when direct live SQL access is unavailable.

Inventory the export before restore and capture as much as its format supports:

- PostgreSQL version metadata if present;
- schemas, extensions and custom types;
- public/application tables;
- Auth tables and identity records included in the export;
- Storage metadata tables included in the export;
- functions, triggers, RLS policies and grants;
- migration history;
- cron/pg_cron definitions, especially commands containing `psonnnuhjjskrdazrakk`;
- provider freshness and ingestion-history tables;
- table row counts after a controlled restore/staging inspection;
- important checksums and critical IDs/timestamps.

The export may not reproduce all project-level Lovable/Supabase configuration. Secrets, external Auth provider settings, Edge Function deployment state, Storage object bytes and other control-plane configuration must be inventoried/recreated separately.

## Phase 3 — Independent target baseline

The independent target already exists as `aicis-production` (`qpphncfgbhizvnovzivw`) in `eu-central-1`.

Verified clean target baseline at creation:

- status `ACTIVE_HEALTHY`;
- PostgreSQL 17.6 family;
- 0 public AICIS tables;
- 0 Auth users;
- 0 Storage buckets;
- 0 Storage objects.

Do not change production frontend environment variables yet.

## Phase 4 — Controlled database restore

Do **not** blindly replay historical migrations or overwrite Supabase-managed internals.

Determine the export format first, then follow current Supabase logical restore guidance appropriate to that format. Prefer a Session pooler/direct database connection intended for migration work rather than transaction-mode pooling.

Restore by category and verify after each stage:

1. **Extensions and custom/application schemas** — match required extensions first, then restore application schema and data while preserving IDs and timestamps.
2. **Auth** — preserve user UUIDs, identities, memberships and application foreign-key relationships. Because Lovable's export does not promise portable passwords, plan a controlled password-reset/reauthentication path. Existing source JWT sessions must not be assumed valid on the target.
3. **Storage metadata** — restore only in a way compatible with the target's managed Storage service.
4. **Storage object bytes** — upload/copy the separately downloaded object payloads and verify path/size/checksum parity.
5. **Edge Functions** — deploy repository functions only after reviewing each function's intended JWT/custom-auth policy.
6. **Secrets** — recreate required target runtime/provider secrets securely; do not recreate obsolete Lovable credentials such as `LOVABLE_API_KEY`.
7. **Auth configuration** — reproduce required redirect URLs/provider settings separately.
8. **Cron/schedulers** — keep all restored source-bound schedules disabled until explicitly rebound to target-only endpoints.
9. **External callbacks/webhooks** — repoint only after target validation.

If the exported SQL/archive tries to alter Supabase-managed roles, ownership, subscriptions, or system objects, stop and split the restore into a safer controlled application/Auth/Storage migration instead of forcing it through.

## Phase 5 — Target cron isolation

Historical source migrations contain hard-coded references to `psonnnuhjjskrdazrakk`. Restoring them unchanged can create split-brain AICIS.

Use `migration/target/001_rebind_pipeline_cron.sql` only on the independent target and only after its required target Vault values are present:

- `aicis_project_url`
- `aicis_publishable_key`
- `aicis_cron_secret`

`aicis_cron_secret` must match the target Edge Function secret `CRON_SECRET`. The publishable key is an API key and belongs in the `apikey` header; it must not be treated as a Bearer JWT.

The restore-phase target migration is a **quarantine barrier**: it creates the target-safe invocation helper and disables **every restored cron job**, including jobs whose commands look harmless but call stored PostgreSQL wrappers that still contain the source ref. It intentionally activates zero schedules. During restore, shadow validation and parity, `cron.job` must have zero active writers. Audited schedules are enabled only after the final cutover gate by the explicitly separated `migration/target/cutover/001_activate_audited_cron.sql` file.

## Phase 6 — Verification gate

When direct source SQL is unavailable, parity must be measured against the validated T0/final export manifests and source-side UI/export evidence rather than pretending `AICIS_SOURCE_DATABASE_URL` exists.

If direct source access later becomes legitimately available, `scripts/aicis-migration-verify.sh` can compare source and target directly using:

- `AICIS_SOURCE_DATABASE_URL`
- `AICIS_TARGET_DATABASE_URL`

Required gates include:

### Database
- intended source/export table set = target table set;
- exact row counts match at the final checkpoint;
- critical IDs and timestamps are preserved;
- critical checksums match.

### Auth
- exported/source identity count = target identity count;
- user UUIDs/identity relationships are intact;
- application foreign keys to Auth users remain intact;
- login or password-reset flow, protected routes, refresh behavior and logout work on target.

### Storage
- bucket count matches;
- object count matches;
- total/critical bytes match;
- object paths and critical checksums match;
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

## Phase 7 — Shadow validation and final-delta strategy

A T0 Lovable export is not zero-data-loss while the source continues receiving writes.

After the initial target restore:

- keep production writers on the source;
- keep target writers disabled or safely isolated;
- validate target reads/Auth/Storage/functions without causing duplicate external side effects;
- compare provider/domain counts and freshness;
- design the final delta around the source capabilities actually available.

Because Lovable limits full exports to once per 24 hours, the preferred final cutover pattern is:

1. restore and validate T0 well before cutover;
2. choose a controlled cutover window;
3. stop or minimize **application-level source writes** without pausing/removing Lovable Cloud;
4. request/download the final permissible export or capture a proven incremental delta through supported data-export/API mechanisms;
5. apply the final delta to target;
6. prove parity at the cutover checkpoint;
7. execute the cutover-only scheduler activation (`migration/target/cutover/001_activate_audited_cron.sql`) and enable target writers;
8. switch frontend/runtime to target;
9. prove no new source writes occur.

Do not claim zero-data-loss unless the final-delta/write-freeze procedure is proven.

## Phase 8 — Frontend and runtime cutover

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

## Phase 9 — Production write and provider-freshness proof

After runtime switches to the target, create or observe a controlled new production event.

Prove:

- the event appears on the target;
- the event does **not** appear on the source;
- downstream target pipelines process it;
- each active provider creates fresh target records on its expected cadence;
- target logs contain the expected executions/errors/retries.

There must be exactly one active production writer after cutover.

## Phase 10 — Lovable-pause test

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

## Phase 11 — Post-cutover disaster recovery

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
