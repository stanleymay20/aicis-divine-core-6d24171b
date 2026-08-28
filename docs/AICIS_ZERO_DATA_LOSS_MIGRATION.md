# AICIS Zero-Data-Loss Cloud Migration

## Objective

Move AICIS away from Lovable-managed backend infrastructure without losing database rows, Auth identities, Storage object bytes, ingestion history, scheduler state, Edge Function behavior, or operational configuration.

## Critical source-identity correction — 2026-08-28

The correct Lovable AICIS project is:

- project ID: `3e68d974-d275-4a8c-8b33-e785fe8113c6`
- project name: `aicis-divine-core`
- published URL: `https://aicis-divine-core.lovable.app`
- repository identity: `AICIS — AI Civilization Intelligence System`

Lovable project `28b43e06-9231-4c54-bc18-a49be01a6516` is **Quantivis**, not AICIS. Read-only inspection of that project returns a Quantivis repository. Therefore every database/Auth/Storage/cron count previously attributed to AICIS solely through that project ID is invalidated for AICIS migration purposes.

Specifically, the prior observations of 210 public tables, 172 Auth users, 2 Storage buckets, 45 Storage metadata objects, 186 migration-history rows, 26 active cron jobs, and runtime references to `itpwpnwzzitkelffttyx` are quarantined as cross-project evidence. They MUST NOT be used for AICIS restore, parity, scheduler activation, final-delta, or cutover decisions unless independently re-observed on the correct AICIS source.

This correction is safety-critical: Quantivis infrastructure and data must never be copied into, modified for, or treated as the AICIS source.

## Current source and target

### Correct AICIS source

The authoritative production source remains the backend attached to Lovable project `3e68d974-d275-4a8c-8b33-e785fe8113c6` until a controlled cutover is completed.

The repository currently declares Supabase project ref `psonnnuhjjskrdazrakk` in `supabase/config.toml`. That repository binding is historical/configuration evidence only; it does not by itself prove the active runtime database identity.

The previously observed runtime ref `itpwpnwzzitkelffttyx` is now quarantined because that observation came through the wrong Lovable project. Keep defensive guards against stale source refs where they already exist, but do not describe `itpwpnwzzitkelffttyx` as proven AICIS runtime identity until it is independently observed on the correct AICIS project.

At the latest check, the correct AICIS Lovable project reports its database as enabled, but SQL connectivity is unavailable. Source counts, exact cron schedules, Auth counts and Storage counts are therefore **unknown**, not zero and not inherited from Quantivis.

### Independent target

- project: `aicis-production`
- project ref: `qpphncfgbhizvnovzivw`
- organization: `pkypvduicdrzjcrbexcy`
- region: `eu-central-1`
- status: `ACTIVE_HEALTHY`

Latest verified target baseline:

- 0 public application base tables
- 0 Auth users
- 0 Storage buckets
- 0 Storage objects
- target writers OFF

The target must remain isolated from production writers until all migration gates pass.

## Non-negotiable rules

1. Never use Quantivis data, Auth, Storage, cron, secrets, source IDs or infrastructure as AICIS migration evidence.
2. Never delete, truncate, reset, recreate, repoint, pause or mutate the AICIS source merely to simplify migration.
3. Never enable target writers before source preservation, restore, Auth, Storage, function deployment, parity and final-delta gates are proven.
4. Never infer missing timestamps, confidence, freshness, schedules, counts or identities.
5. Never copy source secrets. Provision fresh target secrets.
6. Never upload plaintext production dumps or Storage payloads to public GitHub or ordinary CI artifacts.
7. Historical source-bound SQL is evidence. Quarantine executable bindings on the target rather than erasing history.
8. A failed or incomplete comparison blocks cutover.
9. Do not blindly replay all historical migrations into a managed Supabase target without restore-order and managed-schema review.
10. CI success is necessary but does not prove migration parity or production readiness.

## Gate 0 — Correct source identity

Before any T0 claim, prove that all source observations come from Lovable project `3e68d974-d275-4a8c-8b33-e785fe8113c6`.

Required evidence:

- project metadata identifies `aicis-divine-core`;
- repository/file identity is AICIS;
- database queries or export originate from that same project;
- no Quantivis project ID or source data is used as AICIS source evidence.

`migration/source/live-source-checkpoint-20260828.json` version 2 records the correction and invalidates the earlier cross-project checkpoint.

## Gate 1 — Immutable T0 preservation

Preferred path: official Lovable project-data export from the **correct AICIS project**.

Preserve separately:

- database structure and data;
- Auth material provided by the supported export path;
- Storage metadata;
- actual Storage object bytes;
- Edge Function source from canonical GitHub `main`;
- scheduler definitions/schedules;
- configuration inventory without secret values.

For each artifact record:

- source project identity;
- filename/type;
- byte size;
- SHA-256 checksum;
- creation/export time;
- validation result.

Do not call a read-only SQL inventory a backup. Do not call T0 complete until recoverable database and Storage payloads exist and are checksummed.

The repository contains `.github/workflows/data-preservation.yml` and backup scripts for legitimate direct-source credentials. That workflow has not yet produced a proven preservation artifact and must fail closed if required secrets are absent.

## Gate 2 — Source inventory

After correct AICIS source access or export becomes available, capture:

- PostgreSQL version;
- schemas/extensions/custom types;
- public/application table set and row counts;
- Auth users/identities relevant to application relationships;
- Storage buckets, object metadata and object bytes;
- functions/triggers/RLS/grants;
- migration history;
- pg_cron jobs, exact schedules and command targets;
- provider freshness and ingestion history;
- critical IDs/timestamps/checksums;
- source-bound URLs/project refs in executable objects.

Unknown values stay unknown until observed.

## Gate 3 — Controlled target restore

Restore into `qpphncfgbhizvnovzivw` only after a valid T0 exists.

Restore categories deliberately:

1. application schemas/extensions/types;
2. application data preserving IDs/timestamps;
3. Auth identities using a supported migration path;
4. Storage metadata using a target-compatible path;
5. Storage object bytes with path/size/checksum verification;
6. Edge Functions from audited canonical GitHub source;
7. fresh target secrets;
8. Auth redirect/provider configuration;
9. scheduler definitions in disabled/quarantined state.

Immediately after restore, prove zero active target writers.

## Gate 4 — Auth

Required proof:

- intended source/export identity count matches target;
- user UUID relationships remain intact;
- protected routes work;
- login/reauthentication or password-reset path is proven;
- refresh/logout behavior works;
- no source session is assumed valid merely because IDs were preserved.

## Gate 5 — Storage

Required proof:

- bucket set matches intended source/export set;
- object paths match;
- object counts match;
- critical and aggregate byte counts match;
- checksums match for preserved objects;
- target read/write policies work as intended.

Storage control-plane health is not object-byte parity.

## Gate 6 — Secrets and Edge Functions

Provision fresh target values for required provider/runtime secrets. Never copy obsolete Lovable credentials simply because they existed historically.

For every required function prove:

- canonical implementation exists;
- relative imports resolve;
- auth model matches actual executable callers;
- privileged functions are not anonymously callable;
- missing evidence remains NULL/unknown where appropriate;
- deterministic heuristics are not described as calibrated probabilities or verified causal truth;
- function is deployed successfully on target.

## Gate 7 — Scheduler parity

The previous 26-job manifest was based on Quantivis and has been quarantined. It is not an AICIS source scheduler inventory.

`migration/target/cutover/live-source-cron-decisions.json` version 2 therefore contains zero verified AICIS live-source jobs until the correct source can be inventoried.

Do not infer schedules from names such as `-5m`, `-daily` or `-6h`. Exact schedules must come from correct-source evidence.

Target-only jobs may remain designed in cutover SQL, but none may be activated merely because the source inventory is missing. `scripts/audit-live-cron-parity.py --cutover-ready` must fail while `source_inventory_status` is not `verified_current_aicis_source`.

## Gate 8 — Parity

Before final cutover compare the validated source/export checkpoint against target.

Required categories:

- table/schema/object set;
- exact or explicitly scoped row counts;
- critical checksums;
- Auth identity relationships;
- Storage object bytes;
- function deployment set;
- security/RLS expectations;
- scheduler set and exact schedules;
- provider freshness;
- source-bound executable references.

No parity claim may use the invalidated Quantivis checkpoint.

## Gate 9 — Final delta and write freeze

T0 is not zero-data-loss if the source continues receiving writes.

For cutover:

1. validate target while source remains authoritative;
2. choose a controlled cutover window;
3. stop/minimize application-level source writes using a proven procedure;
4. capture a final supported export/incremental delta;
5. apply delta to target;
6. prove final parity;
7. enable only audited target schedulers/writers;
8. switch frontend/runtime to target;
9. prove no new source writes occur.

If a final delta cannot be proven, zero-data-loss cutover remains blocked.

## Gate 10 — Runtime cutover

Only after all prior gates pass:

- point production frontend to target URL/publishable key;
- configure target Auth redirects;
- deploy current canonical GitHub `main`;
- verify browser/network traffic contains no operational Lovable/source endpoint;
- intentionally update `supabase/config.toml` to the target project ref;
- run pause-readiness and source-binding audits;
- prove exactly one active production writer.

## Gate 11 — Lovable independence proof

AICIS is independent only when it is truthful to say that Lovable can become unavailable without stopping normal operation.

Prove:

- frontend availability;
- Auth;
- database reads/writes and RLS;
- Storage reads/writes;
- critical Edge Functions;
- schedulers;
- provider ingestion freshness;
- decision/intelligence pipelines;
- logs/observability;
- no source writes or runtime dependencies.

## Rollback

If target validation fails after cutover:

- disable target writers;
- route production back to the known-good AICIS source only if it remains available and consistent;
- re-enable source writers only if they were deliberately disabled;
- investigate mismatch before another attempt.

Never roll back by overwriting the known-good source with target data.

## Current status

- Correct AICIS Lovable project identity: proven at project/repository level.
- Correct AICIS source database inventory: blocked/unavailable.
- Portable T0 database backup: not proven.
- Storage-byte preservation: not proven.
- Independent target: healthy and intentionally empty.
- Target writers: OFF.
- Auth/Storage/function parity: not proven.
- Final delta: not proven.
- Cutover: BLOCKED.

The next priority is to regain read-only/export access to the correct AICIS source, capture an immutable T0, and only then begin controlled target restore.
