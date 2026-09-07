# AICIS Lovable Cloud migration staging runbook v1

Status: **controlled runbook; no infrastructure provisioned; no production restore authorised**  
Control date: 2026-09-07

## Non-negotiable boundary

This runbook exists only to inspect and restore AICIS historical Lovable Cloud data in a disposable environment.

It does **not** authorise:

- disconnecting or modifying Lovable Cloud;
- restoring into `aicis-production` (`qpphncfgbhizvnovzivw`);
- exposing the dump publicly;
- putting database or Google credentials in Git;
- activating source or destination writers, cron jobs, Edge Functions, or model training;
- claiming migration completeness while `community_metrics` is absent;
- activating paid UpCloud infrastructure without explicit approval.

AICIS remains an experimental multidomain probabilistic forecasting and operational intelligence system. This migration does not establish production readiness or model performance.

## Current preserved source evidence

The Stanley-owned Google Drive folder `Source Export - Immutable` contains one non-native binary object:

- file: `AICIS_Lovable_Cloud_Production_Export_2026-09-02.dump`
- Drive file ID: `1xEsdFQ-q-vqiJLe-GnjXZEdrv7QCn1pA`
- recorded size: `5,054,844,111` bytes
- MIME type: `application/octet-stream`

Lovable support confirmed that the main export excludes `public.community_metrics` because that table was too large. Therefore the dump is a **partial production export** and cannot satisfy zero-loss migration acceptance by itself.

`community_metrics` remains a required independent delivery. Its source manifest must include at minimum:

- every original column and data type;
- total row count;
- export/snapshot boundary and export time;
- earliest/latest business timestamps, including `captured_at` where present;
- total bytes;
- per-chunk byte count and SHA-256 (preferred) or provider checksum;
- deterministic chunk ordering/key ranges;
- statement of whether the separate export represents the same logical database snapshot as the main dump.

If the main dump and `community_metrics` were produced from different source states, the migration must not silently combine them. A documented snapshot/delta reconciliation plan is required.

## Live-source divergence gate

The preserved dump dates from 2026-09-02. Lovable production remains live.

A final cutover cannot claim zero data loss unless writes after the export snapshot are reconciled. Before cutover choose and prove one controlled strategy, for example:

1. a final consistent export during a bounded write freeze; or
2. a verified source-side delta export from the preserved snapshot boundary through the cutover boundary; or
3. another source-supported change-capture method with exact completeness evidence.

The September 2 dump is suitable for forensic restore rehearsal. It is not automatically the final cutover snapshot.

## Proposed temporary UpCloud host — approval candidate

### Region

`de-fra1` — Frankfurt, Germany.

### Initial compute

UpCloud **Starter** plan:

- 4 vCPU
- 16 GB RAM
- 50 GB Standard storage included for the OS
- 500 Mbit/s network tier
- current listed price at control date: **€28/month**, billed by starting hour, maximum 28 days/month

Why this plan: the job is temporary transfer/inspection/restore work, not production. 16 GB RAM gives materially more restore headroom than the cheaper 8 GB tier while keeping short-lived hourly cost low.

### Additional data volume

- 500 GB Standard Block Storage
- encryption at rest enabled **at creation**
- mount dedicated to migration artifacts and isolated PostgreSQL data
- current listed Standard storage rate at control date: **€0.085/GB/month**
- estimated 500 GB storage allocation: **€42.50/month**

Encryption at rest is free and uses provider-managed AES-256. It must be enabled when storage is created; it cannot be retroactively toggled onto the same device.

### Cost envelope before tax

Current price snapshot:

- compute: €28.00/month
- additional 500 GB Standard storage: €42.50/month
- full-month-equivalent allocation: **€70.50/month before applicable tax**

Approximate short-lived cost, using UpCloud's hourly billing conventions:

- 24 hours: **€2.42**
- 48 hours: **€4.83**
- 72 hours: **€7.25**
- 7 days: **€16.92**

These are planning estimates, not invoices. Re-check the UpCloud calculator immediately before provisioning.

### Capacity is a gate, not an assumption

The 5.05 GB archive is compressed/packed data and does not reveal the final restored footprint by file size alone. The historically reported production footprint is much larger, and `community_metrics` is still missing.

500 GB is therefore an **initial staging allocation**, not a claim of sufficiency.

After the main-dump restore:

- record database and filesystem sizes;
- require at least 30% free capacity before importing `community_metrics`;
- otherwise resize the encrypted Standard volume before importing anything else;
- never infer the future `community_metrics` footprint before its manifest arrives.

UpCloud supports block-storage volumes up to 4 TB each and multiple attached devices, so capacity can be increased without pre-purchasing a large speculative volume.

## Host hardening before any source data arrives

Use Ubuntu 24.04 LTS unless the archive inspection reveals a compatibility reason to choose otherwise.

Required controls:

1. Deploy with an SSH public key only. Do not enable reusable password authentication.
2. Create a non-root administrative user, e.g. `aicis-migrate`, with narrowly scoped sudo.
3. Disable SSH password authentication and direct root SSH after the admin key path is verified.
4. Enable the UpCloud firewall with inbound default deny.
5. Permit inbound TCP/22 only from the administrator's current trusted public IP. Do not open PostgreSQL TCP/5432 publicly.
6. Enable an OS firewall as a second layer with the same inbound policy.
7. Permit only bootstrap-required outbound DNS/HTTP/HTTPS/NTP traffic. After the dump and required packages are present, close outbound Internet access before executing any restore.
8. Disable the metadata service if it is not required.
9. Disable IPv6 unless it is explicitly configured and firewalled.
10. Enable encryption at rest on both OS/data storage where selectable at creation.
11. Do not enable automated backups for this disposable sensitive-data host; the immutable Drive source remains the preservation copy and unnecessary backup replicas increase data exposure.
12. Keep no production Supabase, Lovable, API, model-provider, or application secrets on the host.
13. Do not run public web services on the host.
14. Record server UUID, region, image, plan, storage IDs, creation time, firewall rules, and package versions in the migration evidence log.

UpCloud's public/utility firewall is stateless, so its rule set must explicitly account for allowed return traffic. Firewall configuration must be verified before data transfer begins.

## Secure Google Drive transfer

Do not create a public Drive link.

Preferred transfer identity:

1. Create a temporary Google service-account identity dedicated to this migration.
2. Share only `Source Export - Immutable` read-only with that identity.
3. Use a dedicated Google OAuth client / rclone configuration rather than rclone's shared client ID.
4. Store the service-account credential file on the VM with mode `0600`, outside the repository and outside shell history.
5. Configure rclone read-only for the shared folder.
6. Record remote file ID, size and provider-reported hashes before copy.
7. Download to the encrypted data volume.
8. Revoke the folder share and destroy the temporary credential/config as soon as transfer verification completes.

Google Drive supports content hashes for stored files. Record SHA-256 when the remote exposes it; record MD5 as an additional transfer checksum. MD5 must not be promoted into the canonical AICIS cryptographic identity.

After download, run:

```bash
scripts/migration/aicis-inspect-lovable-dump-v1.sh \
  /srv/aicis-migration/source/AICIS_Lovable_Cloud_Production_Export_2026-09-02.dump
```

The inspection script:

- refuses symlink input;
- records byte size;
- computes local SHA-256 and MD5;
- records file type and `pg_restore` client version;
- executes `pg_restore --list` without connecting to a database;
- renders schema-only SQL to a file for static review;
- hashes inspection outputs;
- performs only heuristic risk-pattern triage;
- never restores data.

A successful local hash proves the identity of the downloaded bytes. It does **not** prove the main dump equals Lovable's source-side artifact unless a source-side cryptographic hash is supplied or another controlled source-integrity mechanism exists.

## Archive compatibility gate

Do not guess the source PostgreSQL major version or dump format.

Before creating the restore database:

1. record `file` output;
2. record `pg_restore --version`;
3. generate `pg_restore --list`;
4. inspect the archive header/list for dump format/version and source metadata;
5. render schema-only SQL without execution;
6. inventory required roles, extensions, schemas, foreign-data wrappers, event triggers, procedural languages and Supabase-specific objects;
7. choose a PostgreSQL/Supabase staging version only after this evidence is known.

If the installed `pg_restore` cannot read the archive, install a compatible **newer-or-equal** PostgreSQL client rather than modifying the dump.

PostgreSQL warns that restoring a dump can execute arbitrary code chosen by source superusers. Static inspection is mandatory before restore, and the actual restore must occur only after outbound Internet is blocked and no sensitive credentials remain on the machine.

## Isolated restore sequence

### Phase A — immutable-byte inspection

No database running is required.

Acceptance:

- local byte size recorded;
- Drive remote size recorded;
- remote checksum recorded where available;
- local SHA-256 recorded;
- remote/local hash comparison recorded;
- archive list produced;
- schema SQL produced and reviewed;
- no unexplained archive/parser errors.

### Phase B — disposable relational restore

Create a fresh local PostgreSQL cluster or isolated Supabase-compatible staging stack only after the archive compatibility gate.

Controls:

- database binds only to loopback/private interfaces;
- port 5432 is never Internet-exposed;
- outbound Internet blocked during restore;
- destination contains no production credentials;
- no application writers, cron, Edge Functions, hooks, queues or model jobs run;
- restore into an empty disposable database;
- preserve pg_restore logs verbatim;
- fail on unexplained restore errors;
- do not silently drop ownership/RLS/ACL semantics merely to make restore green;
- any required compatibility role/extension is documented before creation.

Then run the read-only verification SQL:

```bash
psql --set=ON_ERROR_STOP=1 \
  --file scripts/sql/aicis-migration-restore-verification-v1.sql \
  <isolated-connection-string>
```

The verification result is evidence about that isolated restore only.

### Phase C — `community_metrics`

Do not execute until Lovable supplies the table export and source manifest.

For every chunk:

- verify expected filename/order/key range;
- verify byte count;
- verify provider checksum;
- compute local SHA-256;
- import exactly once into staging;
- verify total rows, distinct IDs, time coverage, source/domain/country coverage and orphan references;
- compare the combined table to the source manifest;
- reconcile snapshot boundaries with the main dump.

A manifest row or chunk filename alone cannot create evidence of completeness.

### Phase D — Supabase platform parity

Database restore is not platform migration completion.

Independently reconcile:

- Auth user IDs and identity relationships;
- password-reset strategy where credentials are not transferable;
- Storage object bytes and object metadata;
- Edge Functions from repository source;
- secrets re-entered through secure target controls, never Git;
- scheduled jobs/cron inventory and parity;
- required extensions/configuration;
- RLS and security behavior;
- application-level read-only smoke tests.

Do not activate writers in staging until the restored state has passed integrity verification.

## Cutover decision gate

Do not cut over unless all of these are true:

- main dump identity/format recorded and independently inspected;
- main isolated restore completed without unexplained errors;
- `community_metrics` received and source-manifest verified;
- snapshot/delta consistency between main dump and `community_metrics` resolved;
- post-2026-09-02 live-source writes reconciled to a final cutover boundary;
- row counts/time ranges/duplicates/orphans/critical assets pass;
- Auth/Storage/functions/secrets/cron parity is documented;
- destination security/RLS behavior is proved;
- source Lovable production remains available as rollback authority until acceptance;
- `aicis-production` has not been used as the rehearsal target.

## Cleanup

After evidence artifacts are copied to their approved secure destination:

1. revoke the temporary Drive share/service account;
2. delete Drive/rclone credentials from the VM;
3. securely remove temporary DB credentials;
4. stop PostgreSQL/Supabase staging services;
5. delete the UpCloud server and attached staging storage after confirming required evidence outputs are preserved;
6. confirm the server/storage no longer appear in the UpCloud account;
7. record deletion time and final billed duration;
8. retain only approved hashes, logs, inventories and verification reports — never secrets.

## Price/documentation references used for this control snapshot

- UpCloud Cloud Servers pricing: https://upcloud.com/products/cloud-servers/
- UpCloud Block Storage: https://upcloud.com/global/products/block-storage/
- UpCloud Block Storage encryption at rest: https://upcloud.com/docs/products/block-storage/encryption-at-rest/
- UpCloud firewall: https://upcloud.com/docs/products/networking/firewall/
- UpCloud block-storage locations: https://upcloud.com/docs/products/block-storage/availability/
- rclone Google Drive backend: https://rclone.org/drive/
- PostgreSQL `pg_restore`: https://www.postgresql.org/docs/current/app-pgrestore.html

Re-verify live pricing and service behavior before provisioning; these references are evidence for the 2026-09-07 design snapshot, not perpetual price guarantees.
