#!/usr/bin/env bash
set -euo pipefail

: "${AICIS_SOURCE_DATABASE_URL:?AICIS_SOURCE_DATABASE_URL is required}"
OUT_DIR="${1:-artifacts/aicis-source-inventory}"
mkdir -p "$OUT_DIR"

PSQL=(psql "$AICIS_SOURCE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At)
SOURCE_REFS=(
  "psonnnuhjjskrdazrakk"
  "itpwpnwzzitkelffttyx"
)

# Refuse obvious target confusion if a target URL is also present.
if [[ -n "${AICIS_TARGET_DATABASE_URL:-}" && "$AICIS_SOURCE_DATABASE_URL" == "$AICIS_TARGET_DATABASE_URL" ]]; then
  echo "Source and target database URLs are identical; refusing inventory." >&2
  exit 1
fi

{
  echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "database=$(${PSQL[@]} -c "select current_database();")"
  echo "server_version=$(${PSQL[@]} -c "show server_version;")"
  echo "database_size_bytes=$(${PSQL[@]} -c "select pg_database_size(current_database());")"
  echo "public_tables=$(${PSQL[@]} -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
  echo "public_rls_policies=$(${PSQL[@]} -c "select count(*) from pg_policies where schemaname='public';")"
  echo "public_functions=$(${PSQL[@]} -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';")"
  echo "auth_users=$(${PSQL[@]} -c "select count(*) from auth.users;" 2>/dev/null || echo unavailable)"
  echo "storage_buckets=$(${PSQL[@]} -c "select count(*) from storage.buckets;" 2>/dev/null || echo unavailable)"
  echo "storage_objects=$(${PSQL[@]} -c "select count(*) from storage.objects;" 2>/dev/null || echo unavailable)"
  echo "migration_rows=$(${PSQL[@]} -c "select count(*) from supabase_migrations.schema_migrations;" 2>/dev/null || echo unavailable)"
  echo "cron_jobs=$(${PSQL[@]} -c "select count(*) from cron.job;" 2>/dev/null || echo unavailable)"
  echo "active_cron_jobs=$(${PSQL[@]} -c "select count(*) from cron.job where active;" 2>/dev/null || echo unavailable)"
} > "$OUT_DIR/summary.txt"

${PSQL[@]} -F $'\t' -c "
select schemaname, relname, n_live_tup::bigint
from pg_stat_user_tables
where schemaname in ('public','auth','storage')
order by schemaname, relname;
" > "$OUT_DIR/table-estimates.tsv"

# Exact row counts for public tables only. Auth/storage counts are captured separately above.
: > "$OUT_DIR/public-table-counts.tsv"
while IFS= read -r table_name; do
  [[ -z "$table_name" ]] && continue
  count="$(${PSQL[@]} -c "select count(*) from public.\"${table_name//\"/\"\"}\";")"
  printf 'public\t%s\t%s\n' "$table_name" "$count" >> "$OUT_DIR/public-table-counts.tsv"
done < <(${PSQL[@]} -c "select tablename from pg_tables where schemaname='public' order by tablename;")

${PSQL[@]} -F $'\t' -c "
select extname, extversion
from pg_extension
order by extname;
" > "$OUT_DIR/extensions.tsv"

${PSQL[@]} -F $'\t' -c "
select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
order by p.proname, arguments;
" > "$OUT_DIR/public-functions.tsv"

${PSQL[@]} -F $'\t' -c "
select schemaname, tablename, policyname, permissive, roles::text, cmd
from pg_policies
where schemaname='public'
order by tablename, policyname;
" > "$OUT_DIR/public-rls-policies.tsv"

# Never export cron command bodies here: historical jobs can embed API keys or
# bearer tokens. Preserve only identity/schedule/activation plus guarded-ref flags.
if ${PSQL[@]} -c "select 1 from pg_extension where extname='pg_cron';" | grep -qx 1; then
  ${PSQL[@]} -F $'\t' -c "
select jobid,
       jobname,
       schedule,
       active,
       (command like '%psonnnuhjjskrdazrakk%') as references_repository_source_ref,
       (command like '%itpwpnwzzitkelffttyx%') as references_live_runtime_ref
from cron.job
order by jobid;
" > "$OUT_DIR/cron-jobs-redacted.tsv" || true
else
  printf 'pg_cron not installed\n' > "$OUT_DIR/cron-jobs-redacted.tsv"
fi

# Count direct cron and stored-function bindings for every guarded source ref.
: > "$OUT_DIR/source-ref-bindings.tsv"
for source_ref in "${SOURCE_REFS[@]}"; do
  cron_count="$(${PSQL[@]} -c "select count(*) from cron.job where command like '%' || :'ref' || '%';" -v ref="$source_ref" 2>/dev/null || echo unavailable)"
  function_count="$(${PSQL[@]} -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.prosrc like '%' || :'ref' || '%';" -v ref="$source_ref" 2>/dev/null || echo unavailable)"
  printf '%s\t%s\t%s\n' "$source_ref" "$cron_count" "$function_count" >> "$OUT_DIR/source-ref-bindings.tsv"
done

# Schema fingerprint is metadata-only: no table row contents are hashed or emitted.
${PSQL[@]} -c "
select md5(string_agg(
  table_schema || '.' || table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,''),
  '|' order by table_schema, table_name, ordinal_position
))
from information_schema.columns
where table_schema in ('public','auth','storage');
" > "$OUT_DIR/schema-fingerprint.txt"

sha256sum "$OUT_DIR"/* > "$OUT_DIR/SHA256SUMS"

echo "AICIS source inventory written to $OUT_DIR"
