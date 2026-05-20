
# AICIS Export Layer — Build Plan

Build a decision-grade export engine that ships clean, compressed, scored intelligence to downstream platforms (Quantivis, partner G7 systems, SDK consumers) via REST, webhook, CSV/JSON/NDJSON, batch, and incremental sync.

## 1. Database (migration)

New tables (all RLS-enabled, org-scoped via `has_role` / `organization_members`):

- `export_profiles` — config per org: name, destination_type, domains[], countries[], regions[], min_relevance, min_confidence, severity_tiers[], urgency_min, frequency, max_records_per_run, include_raw_source, include_recommendations, include_explanations, prefer_clusters, schema_version, enabled, secret_id
- `export_runs` — profile_id, organization_id, status (queued/running/success/partial/error), records_selected, records_exported, clusters_exported, recommendations_exported, duration_ms, payload_size_bytes, retry_count, cursor_start, cursor_end, export_batch_id (uuid), error, storage_path, signed_url_expires_at
- `export_webhooks` — org_id, profile_id, endpoint_url, secret (hash), event_types[], min_relevance, retry_policy jsonb, enabled, last_success_at, last_error_at, consecutive_failures
- `export_webhook_deliveries` — webhook_id, run_id, event_type, idempotency_key (uq), payload_hash, http_status, attempt, delivered_at, response_excerpt, signature
- `export_api_keys` — org_id, key_prefix, key_hash, scopes[], last_used_at, revoked_at, rate_limit_per_min
- `export_audit_logs` — actor (user_id/api_key_id), org_id, action, resource_type, resource_id, ip, ua, metadata jsonb
- `export_cursor_state` — profile_id, last_signal_updated_at, last_signal_id (keyset)
- Preset seed: `quantivis_decision_intelligence` profile template row in `export_profile_presets`

Indexes on (organization_id, created_at desc), (profile_id, status), keyset (updated_at desc, id desc) for signals export.

## 2. Edge functions

All under `supabase/functions/`:

- `exports-api` (single router, verify_jwt=false, validates API key OR JWT):
  - `GET /exports/signals` — keyset sync (`since`, `until`, `cursor`, `limit`, `updated_after`); applies profile filters; returns SDK envelope
  - `GET /exports/clusters` — pulls from `signal_clusters` / dedup groups
  - `GET /exports/recommendations` — from `risk_action_recommendations`
  - `GET /exports/entities` — normalized entity registry
  - `GET /exports/risk-briefs` — composed brief per country/domain
  - `POST /exports/profiles` — create/update profile
  - `POST /exports/run` — enqueue run
  - `GET /exports/runs/:id` — status
  - `GET /exports/runs/:id/download.csv|.json|.ndjson` — signed URL redirect
- `exports-runner` — executes a run: compress → dedupe → cluster → normalize → score → compose decision schema → write file (gzip when >1MB) to `aicis-exports` bucket → record metrics → fire webhooks
- `exports-webhook-dispatcher` — HMAC-SHA256 signed payloads, exponential backoff retry (1m/5m/30m/2h/12h), idempotency key, delivery log
- `exports-cron-15m` — scans enabled profiles by frequency, enqueues runs

Shared module `_shared/export-schema.ts`:
- `DecisionGradeSignal` zod schema (all 20 fields from spec)
- `compressSignals(rows, profile)` — dedupe by `dedup_key`, cluster by (country, domain, 24h window), entity/country normalization via existing canonical tables, severity/relevance/urgency scoring, summary compression, recommendation join
- `validateExport(rows)` — quality controls (unique IDs, non-null country/domain/severity, score ranges, ISO timestamps)
- `buildEnvelope(data, cursor, schemaVersion)` — SDK-ready response

Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-Schema-Version`, `X-Export-Batch-Id`, `X-Next-Cursor`.

## 3. Quantivis preset

On migration, seed `export_profile_presets` with `quantivis_decision_intelligence`:
- min_relevance 70, min_confidence 60, urgency_min 50
- max 500 records/run, prefer_clusters=true
- include_recommendations/explanations/provenance=true
- domains: all 8
- destination_type: api (overridable to webhook)
- schema_version: `quantivis.v1`

Helper RPC `clone_export_preset(preset_key, org_id)` creates a profile from preset.

## 4. Frontend (`/exports` page)

Minimal admin UI (operator/admin role):
- Profiles list + "Create from preset" (Quantivis button)
- Profile editor form (domains, countries, thresholds, destination)
- Runs table (status, records, size, download links)
- Webhooks panel (endpoint, secret reveal once, deliveries log)
- API keys panel (create/revoke, copy once)
- Audit log viewer

Reuse existing semantic tokens; no new design system work.

## 5. Security

- API keys: `aicis_live_<prefix>_<random>`, store SHA-256 hash, validate via constant-time compare in edge fn
- Webhook signatures: `t=<ts>,v1=<hmac_sha256(ts+"."+body)>` header `X-AICIS-Signature`
- RLS: all tables scoped via `has_role(auth.uid(),'admin')` + org membership
- Rate limit reuse existing `api_rate_limits` infra (per API key, default 120/min, profile-overridable)
- Audit every endpoint hit + run + webhook delivery
- Retention: cron purges `export_runs` files >30d, `export_audit_logs` >180d

## 6. Technical notes

- Storage bucket: reuse `aicis-exports` (already private)
- Compression: existing `gzip` import from `compress@v0.4.5`
- Keyset pagination: `WHERE (updated_at, id) < (cursor_ts, cursor_id) ORDER BY updated_at DESC, id DESC LIMIT N`
- Cluster source: `global_signals` grouped by `(affected_countries[1], category, date_trunc('day', latest_update_at))` with weighted severity/confidence
- Recommendations join: `risk_action_recommendations` by (country, domain)
- Output envelope:
```json
{
  "schema_version": "quantivis.v1",
  "export_batch_id": "uuid",
  "generated_at": "ISO",
  "cursor": { "next": "...", "has_more": true },
  "count": 123,
  "data": [ /* DecisionGradeSignal[] */ ]
}
```

## 7. Out of scope (this loop)

- Multi-language SDK packages (npm/python) — contract is documented, packages later
- Realtime push (SSE/WebSocket) — webhooks cover push for now
- Custom data residency routing — reuse sovereign mode controls

## File deltas (estimate)

- 1 migration (~12 tables/indexes/RLS + preset seed)
- `supabase/functions/exports-api/index.ts`
- `supabase/functions/exports-runner/index.ts`
- `supabase/functions/exports-webhook-dispatcher/index.ts`
- `supabase/functions/exports-cron-15m/index.ts`
- `supabase/functions/_shared/export-schema.ts`
- `src/pages/ExportLayer.tsx` + route in `App.tsx`
- Sidebar entry under Governance/Ops
- One pg_cron schedule via `supabase--insert`

Approve to proceed and I'll ship the migration first, then functions, then UI.
