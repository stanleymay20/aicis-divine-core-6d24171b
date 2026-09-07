#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: aicis-inspect-lovable-dump-v1.sh /path/to/export.dump [output-directory]

Inspection only. This script never connects to PostgreSQL and never restores data.
It records local file identity, pg_restore metadata/listing, and a schema-only SQL
render for manual review before any isolated restore is authorised.
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 64
fi

DUMP=$1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUTDIR=${2:-"aicis-dump-inspection-${STAMP}"}

if [[ -L "$DUMP" ]]; then
  echo "Refusing symlink dump path: $DUMP" >&2
  exit 65
fi
if [[ ! -f "$DUMP" ]]; then
  echo "Dump is not a regular file: $DUMP" >&2
  exit 66
fi

for command in stat sha256sum md5sum file pg_restore grep wc awk; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command missing: $command" >&2
    exit 69
  fi
done

if [[ -e "$OUTDIR" ]]; then
  echo "Refusing to overwrite existing output path: $OUTDIR" >&2
  exit 73
fi
mkdir -m 0700 "$OUTDIR"

SIZE_BYTES=$(stat -c '%s' "$DUMP")
SHA256=$(sha256sum "$DUMP" | awk '{print $1}')
MD5=$(md5sum "$DUMP" | awk '{print $1}')
FILE_TYPE=$(file --brief "$DUMP")
PG_RESTORE_VERSION=$(pg_restore --version)

cat >"$OUTDIR/file-identity.txt" <<EOF
inspection_utc=${STAMP}
input_path=${DUMP}
size_bytes=${SIZE_BYTES}
sha256=${SHA256}
md5=${MD5}
file_type=${FILE_TYPE}
pg_restore_version=${PG_RESTORE_VERSION}
EOF

# pg_restore --list parses the archive TOC but does not connect to a database.
pg_restore --list "$DUMP" >"$OUTDIR/pg_restore-list.txt"

# Render schema SQL for static review. --file prevents execution against a DB.
pg_restore --schema-only --file="$OUTDIR/schema-only.sql" "$DUMP"

sha256sum \
  "$OUTDIR/file-identity.txt" \
  "$OUTDIR/pg_restore-list.txt" \
  "$OUTDIR/schema-only.sql" \
  >"$OUTDIR/inspection-artifact-sha256.txt"

# Heuristic triage only. Empty output does NOT prove the dump is safe to execute.
grep -Eni \
  'CREATE[[:space:]]+(EXTENSION|EVENT[[:space:]]+TRIGGER)|COPY.*PROGRAM|LANGUAGE[[:space:]]+c([^a-zA-Z]|$)|CREATE[[:space:]]+FOREIGN[[:space:]]+DATA[[:space:]]+WRAPPER' \
  "$OUTDIR/schema-only.sql" \
  >"$OUTDIR/schema-risk-patterns.txt" || true

{
  echo "archive_list_lines=$(wc -l < "$OUTDIR/pg_restore-list.txt")"
  echo "schema_sql_lines=$(wc -l < "$OUTDIR/schema-only.sql")"
  echo "risk_pattern_lines=$(wc -l < "$OUTDIR/schema-risk-patterns.txt")"
} >"$OUTDIR/inspection-counts.txt"

cat <<EOF
AICIS Lovable dump inspection completed without restoring data.
Output: $OUTDIR
Size:   $SIZE_BYTES bytes
SHA256: $SHA256
MD5:    $MD5

Next gate: compare the remote Drive hash/size to this local identity, review
pg_restore-list.txt and schema-only.sql, then authorise only a disposable,
network-isolated restore target. A successful inspection does not prove export
completeness; community_metrics remains a separately required source artifact.
EOF
