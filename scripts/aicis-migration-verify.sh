#!/usr/bin/env bash
set -euo pipefail

: "${AICIS_SOURCE_DATABASE_URL:?AICIS_SOURCE_DATABASE_URL is required}"
: "${AICIS_TARGET_DATABASE_URL:?AICIS_TARGET_DATABASE_URL is required}"

command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SOURCE_COUNTS="$TMP_DIR/source-counts.tsv"
TARGET_COUNTS="$TMP_DIR/target-counts.tsv"

COUNT_SQL=$(cat <<'SQL'
WITH user_tables AS (
  SELECT n.nspname AS schema_name, c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND n.nspname NOT LIKE 'pg_temp_%'
    AND n.nspname NOT LIKE 'pg_toast_temp_%'
), counts AS (
  SELECT format('%I.%I', schema_name, table_name) AS fqtn,
         schema_name,
         table_name
  FROM user_tables
)
SELECT fqtn || E'\t' ||
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %s', fqtn), false, true, '')))[1]::text
FROM counts
ORDER BY schema_name, table_name;
SQL
)

run_counts() {
  local db_url="$1"
  local out="$2"
  psql "$db_url" \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --command "$COUNT_SQL" \
    | sed -E 's/<c>|<\/c>//g' \
    | sed '/^[[:space:]]*$/d' \
    > "$out"
}

run_counts "$AICIS_SOURCE_DATABASE_URL" "$SOURCE_COUNTS"
run_counts "$AICIS_TARGET_DATABASE_URL" "$TARGET_COUNTS"

# Compare exact table set + exact row counts. Any mismatch blocks cutover.
if ! diff -u "$SOURCE_COUNTS" "$TARGET_COUNTS"; then
  echo "AICIS migration verification FAILED: table set or row counts differ." >&2
  exit 1
fi

# Additional invariants that deserve explicit visibility.
for fqtn in auth.users storage.buckets storage.objects; do
  src=$(awk -F '\t' -v t="$fqtn" '$1==t {print $2}' "$SOURCE_COUNTS" || true)
  dst=$(awk -F '\t' -v t="$fqtn" '$1==t {print $2}' "$TARGET_COUNTS" || true)
  if [[ -n "$src" || -n "$dst" ]]; then
    echo "$fqtn source=${src:-MISSING} target=${dst:-MISSING}"
  fi
done

echo "AICIS migration verification PASSED: all visible table row counts match exactly."
echo "NOTE: this verifies database rows and Storage metadata, not the bytes of Storage objects."
echo "Storage object bytes must also be verified by the encrypted Storage mirror/manifest."