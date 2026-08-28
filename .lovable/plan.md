# AICIS Backend Migration Audit — Lovable Cloud → Self-Owned Supabase (~181 GB)

Informational only. No code, schema, data, functions, secrets, cron jobs, settings, or deployment were modified in this run.

Each item below is marked **[Documented]** (official Lovable docs), **[Observed]** (verified earlier in this project), or **[Assumption]** (my recommendation, not a supported guarantee).

## 1. Full portable PostgreSQL export at ~181 GB

**[Documented]** Lovable Cloud has a self-service database export: Cloud tab > Overview > Advanced settings > "Export project data" > Database > Export > Start export. Lovable emails you when it is ready; you download it from Cloud tab > Storage.

**[Documented]** Limits that disqualify it here:
- Export size limit: **5 GB**. A ~181 GB database is ~36x over the limit.
- Rate limit: **one export per day**.
- Contents: schema + data only. **Excludes** storage files, edge function code, and secrets. **User passwords are not exported in a usable format.**

**Conclusion:** No, the self-service export cannot produce a restorable ~181 GB dump. There is no documented `pg_dump`/`pg_restore`-grade full-size export path in the product UI.

## 2. Supported alternative for a database this size

**[Documented]** None self-service. The docs describe no large-database export tier.

**[Assumption / requires Lovable Support]** The only realistic routes are:
- **A. Escalate to Lovable Support** and request either (i) an internal full `pg_dump`/physical backup handoff, or (ii) a **managed project transfer / infrastructure-level handoff** of the underlying Supabase project into your own Supabase organization. Route (ii) is potentially the **lowest-copy-risk** path, but it is not proven zero-data-loss: what survives a transfer (managed secrets, Auth configuration, cron state, Storage ownership, gateway bindings, billing) and whether downtime is required must be confirmed by Lovable/Supabase in writing.
- **B. Logical replication / self-driven incremental copy** (see §8) if you can obtain read credentials.

Ask Support explicitly for: full backup export above 5 GB, **or** transfer of the managed Supabase project (`psonnnuhjjskrdazrakk`) to a Supabase org you own — and for the written preservation semantics of that transfer.

**Size note:** ~181 GB is **total PostgreSQL database size**, not 181 GB of logical table payload. Indexes, TOAST and database overhead account for a substantial share; a logical dump will likely be materially smaller than 181 GB, though still far above the 5 GB cap.


## 3. Direct PostgreSQL credentials for pg_dump

**[Documented]** No. Lovable Cloud does not expose Postgres connection strings, the database password, or the service-role key. Database access is via the Lovable UI/SQL editor only.

**[Observed]** In this project, service-role key and DB password are explicitly inaccessible; only the public URL and publishable/anon key are available to the frontend.

**Implication:** `pg_dump` against production is impossible without Lovable Support issuing credentials or performing the dump. Temporary read-only credentials are not a documented capability — it must be requested.

## 4. Supported Lovable Cloud → user-owned Supabase migration

**[Documented]** There is **no one-click migration**. The documented path is manual:
1. Export Lovable Cloud data (5 GB cap).
2. Create your own Supabase project; link your Supabase org to your Lovable workspace via Connectors > Supabase.
3. In the Lovable project: More > Cloud > "Already have a Supabase project? Connect it here".
4. Rebuild schema in the new project.
5. Import data.
6. Reconfigure auth, secrets, edge functions.

At 181 GB, steps 1 and 5 are the blockers. Steps 2–3 remain useful because they re-point the Lovable app at your own project once data is in place.

## 5. Auth identities, UUIDs, passwords, sessions

- **[Documented]** Password hashes are **not exported in a usable format** by the self-service export.
- **[Assumption]** Preserving `auth.users.id` UUIDs (which every `user_id` FK in the public tables depends on) and password hashes requires an **officially supported Auth migration/export mechanism, or SQL-level restoration of the `auth` schema** from a real dump — i.e. §2 route A or B. Do not assume any client/Admin API accepts an explicit existing id plus a pre-hashed password; that must be independently verified against current Supabase behaviour before it is planned on.
- **Sessions**: do not rely on preserving existing sessions. Plan for all users to re-authenticate at cutover unless Lovable/Supabase explicitly confirms session-token continuity.
- **Fallback if hashes are unobtainable**: recreate users with the same UUIDs and force a password-reset flow; OAuth (Google) identities re-link by provider subject if `auth.identities` rows are recreated — verify this behaviour before depending on it.

## 6. Storage objects

- **[Documented]** Storage files are **not** included in the database export.
- **[Assumption]** Migrate in two parts: (a) object **bytes** — enumerate buckets/objects via the Storage API with a key that can read them and stream-copy to the new project's buckets; (b) **metadata** — recreate buckets (name, public flag, size limit, allowed MIME types) and re-apply `storage.objects` RLS policies as SQL. Owner IDs and paths should be preserved so existing DB references keep resolving.

## 7. What an export does and does not include

| Artifact | In self-service export | How to handle |
|---|---|---|
| Table schema + data | Yes (≤5 GB) | Blocked at this size |
| RLS policies, DB functions, triggers, views | **Unverified** — must be confirmed from the actual export format, not assumed from "schema-complete" | Verify inclusion; otherwise re-emit as SQL |
| Extensions | **Unverified [Assumption]** typically emitted as `CREATE EXTENSION` lines | Confirm; pre-create in target before restore |
| pg_cron / pg_net jobs (172 total, 171 active — directly observed) | **Unverified**; `cron.job` lives in the `cron` schema and is commonly outside a public-schema dump | Export `cron.job` rows separately; **all jobs stay DISABLED on target** until cutover |
| Edge Functions code | **No** | Re-deploy from `supabase/functions/` in this repo via Supabase CLI |
| Secrets / env vars | **No** | Re-provision fresh values in the new project; never copy |
| Auth config (providers, redirect URLs, email templates) | **No** | Reconfigure manually |
| Migration history (`supabase_migrations.schema_migrations`) | **Unknown — verify export scope** | If absent, copy the table or re-baseline |
| Storage objects | **No** | See §6 |

**Lovable coupling status:** canonical CI currently reports **zero direct Lovable runtime dependencies** (`ai.gateway.lovable.dev`, `LOVABLE_API_KEY`, `@lovable.dev/cloud-auth-*`), per `docs/PORTABILITY_POLICY.md` and the portability gate. Unused Lovable packages/config remnants may still exist and should be inventoried, but no count of gateway-dependent edge functions is asserted here without a fresh audit run against this repository.

## 8. Safest sequence at ~181 GB

**Preferred path, if Lovable/Supabase supports it: managed project transfer or equivalent infrastructure-level handoff.** This may minimize copying and preserve more state than a logical migration, but its preservation guarantees, required downtime, Auth/session behavior, Storage continuity, cron behavior, secrets, billing and Lovable-specific integrations must be confirmed in writing before treating it as a zero-data-loss solution.

**Copy-based sequence [Assumption — shape depends on which export/replication mechanism Lovable can actually provide]:**

```text
T-14d  Open Support ticket: request transfer, or >5GB dump / temporary read creds.
       Do not finalise the sequence below until the mechanism is known.
       In parallel: provision target Supabase project with headroom above the
       actual restored size (181 GB is total DB size incl. indexes/TOAST/overhead;
       logical payload will be smaller).
T-7d   Schema-first: apply extensions, then DDL (tables, types, functions, RLS,
       grants), and with all 172 cron jobs (171 active on source) DISABLED in target.
       Whether to defer indexes/FKs depends on the load mechanism - decide once
       the mechanism is confirmed (helpful for bulk COPY, harmful/unnecessary for
       logical replication or a physical restore).
T-5d   T0 bulk copy of cold/append-only tables (largest first: community_metrics,
       normalized_metrics, global_signals) via COPY streams or logical replication.
       Logical replication is preferred where available - it keeps the delta applied.
T-2d   Build any deferred indexes/FKs. Restore auth users/identities preserving
       UUIDs via a supported mechanism. Copy storage buckets + object bytes.
T-1d   Validation pass: per-table row counts and max(created_at) source vs target,
       checksum/aggregate spot checks on the top 20 tables by size, RLS behaviour
       tests as anon + authenticated, ledger hash-chain integrity re-verification.
T-0    WRITE FREEZE: pause all Lovable Cloud cron jobs and ingestion edge functions;
       put the frontend in read-only. Wait for replication lag = 0 (or run the final
       incremental delta by created_at/updated_at watermark).
T+0    Re-validate row counts on every table. Copy cron.job rows and enable only
       audited jobs in target. Deploy edge functions + freshly provisioned secrets.
       Update auth Site URL and redirect allowlist to the production domain.
T+0    Cutover: repoint VITE_SUPABASE_URL / publishable key to the new project,
       redeploy frontend, smoke-test sign-in, ingestion write, and a dashboard read.
T+7d   Keep the Lovable Cloud project paused-but-retained as rollback until the new
       project has run a full week of crons cleanly. Only then decommission.
```

**Guardrails:** never delete the source until T+7d validation passes; the write freeze must cover pg_cron, not just the UI; all 172 target cron jobs stay disabled until explicitly audited and approved; and the source data disk is at ~77% — do not start a large in-database copy on the source that would consume more disk.

## Bottom line

- Self-service export: **capped at 5 GB — unusable here [Documented]**.
- No direct Postgres credentials, no `pg_dump`, no one-click migration **[Documented]**.
- At this scale, the safest supported migration path currently depends on Lovable's escalation. A managed project transfer / infrastructure handoff is preferred **if** formally supported and its preservation semantics are confirmed in writing. Otherwise we need a supported full backup or another source-access mechanism before beginning the 181 GB data movement.
- Regardless of path, edge function code, secrets, storage bytes, cron jobs, auth config, and any residual Lovable packages/config remnants are **separate manual work**.

