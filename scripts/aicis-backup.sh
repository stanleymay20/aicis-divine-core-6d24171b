#!/usr/bin/env bash
set -euo pipefail

: "${AICIS_DATABASE_URL:?AICIS_DATABASE_URL is required}"
: "${AICIS_BACKUP_PASSPHRASE:?AICIS_BACKUP_PASSPHRASE is required}"

OUT_DIR="${1:-artifacts/aicis-backup}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAW_DUMP="$OUT_DIR/aicis-${STAMP}.dump"
ENC_DUMP="$RAW_DUMP.enc"
SCHEMA_SQL="$OUT_DIR/aicis-${STAMP}-schema.sql"
ENC_SCHEMA="$SCHEMA_SQL.enc"
MANIFEST="$OUT_DIR/aicis-${STAMP}-manifest.txt"

cleanup() {
  rm -f "$RAW_DUMP" "$SCHEMA_SQL"
}
trap cleanup EXIT

command -v pg_dump >/dev/null || { echo "pg_dump is required" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }

# Custom-format dump preserves schema + row data across public/auth/storage/etc.
# The connected database role must have permission to read those schemas.
pg_dump \
  --dbname="$AICIS_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$RAW_DUMP"

# Schema-only copy is useful for recovery planning, but is encrypted before upload.
pg_dump \
  --dbname="$AICIS_DATABASE_URL" \
  --schema-only \
  --no-owner \
  --no-acl \
  --file="$SCHEMA_SQL"

# Validate the custom dump before encrypting it.
pg_restore --list "$RAW_DUMP" >/dev/null

encrypt_file() {
  local input="$1"
  local output="$2"
  openssl enc \
    -aes-256-cbc \
    -pbkdf2 \
    -iter 250000 \
    -salt \
    -in "$input" \
    -out "$output" \
    -pass env:AICIS_BACKUP_PASSPHRASE
}

encrypt_file "$RAW_DUMP" "$ENC_DUMP"
encrypt_file "$SCHEMA_SQL" "$ENC_SCHEMA"

{
  echo "created_utc=$STAMP"
  echo "project_ref=psonnnuhjjskrdazrakk"
  echo "encrypted_dump=$(basename "$ENC_DUMP")"
  echo "encrypted_schema=$(basename "$ENC_SCHEMA")"
  echo "encrypted_dump_sha256=$(sha256sum "$ENC_DUMP" | awk '{print $1}')"
  echo "encrypted_schema_sha256=$(sha256sum "$ENC_SCHEMA" | awk '{print $1}')"
  echo "encrypted_dump_bytes=$(wc -c < "$ENC_DUMP" | tr -d ' ')"
  echo "encrypted_schema_bytes=$(wc -c < "$ENC_SCHEMA" | tr -d ' ')"
  echo "pg_restore_validation=passed"
} > "$MANIFEST"

chmod 600 "$ENC_DUMP" "$ENC_SCHEMA" "$MANIFEST"

echo "AICIS encrypted backup created successfully:"
echo "  $ENC_DUMP"
echo "  $ENC_SCHEMA"
echo "  $MANIFEST"
echo "NOTE: database dumps include Storage metadata, not Storage object bytes themselves."
