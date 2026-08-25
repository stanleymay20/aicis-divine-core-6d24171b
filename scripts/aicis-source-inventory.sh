#!/usr/bin/env bash
set -euo pipefail

: "${AICIS_SOURCE_DATABASE_URL:?AICIS_SOURCE_DATABASE_URL is required}"
OUT_DIR="${1:-artifacts/aicis-source-inventory}"
mkdir -p "$OUT_DIR"

PSQL=(psql "$AICIS_SOURCE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At)

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
  echo "auth_users=$(${PSQL[@]} -c "select count(*) from auth.users;" 2>/dev/null || echo unavailable)"
  echo "storage_buckets=$(${PSQL[@]} -c "select count(*) from storage.buckets;" 2>/dev/null || echo unavailable)"
  echo "storage_objects=$(${PSQL[@]} -c "select count(*) from storage.objects;" 2>/dev/null || echo unavailable)"
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

if ${PSQL[@]} -c "select 1 from pg_extension where extname='pg_cron';" | grep -qx 1; then
  ${PSQL[@]} -F $'\t' -c "select jobid, schedule, active, command from cron.job order by jobid;" > "$OUT_DIR/cron-jobs.tsv" || true
else
  printf 'pg_cron not installed\n' > "$OUT_DIR/cron-jobs.tsv"
fi

sha256sum "$OUT_DIR"/* > "$OUT_DIR/SHA256SUMS"

echo "AICIS source inventory written to $OUT_DIR"
