#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <lovable-database-export> [output-directory]" >&2
  exit 64
fi

EXPORT_PATH="$1"
OUTPUT_DIR="${2:-artifacts/aicis-lovable-export-validation}"

if [[ ! -f "$EXPORT_PATH" ]]; then
  echo "Export file not found: $EXPORT_PATH" >&2
  exit 66
fi

mkdir -p "$OUTPUT_DIR"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "Neither sha256sum nor shasum is available" >&2
    exit 69
  fi
}

file_size() {
  if stat -c '%s' "$1" >/dev/null 2>&1; then
    stat -c '%s' "$1"
  else
    stat -f '%z' "$1"
  fi
}

EXPORT_SHA256="$(sha256_file "$EXPORT_PATH")"
EXPORT_BYTES="$(file_size "$EXPORT_PATH")"
EXPORT_TYPE="$(file -b "$EXPORT_PATH" 2>/dev/null || printf 'unknown')"
EXPORT_NAME="$(basename "$EXPORT_PATH")"

SUMMARY="$OUTPUT_DIR/export-summary.txt"
MANIFEST="$OUTPUT_DIR/pg-restore-list.txt"
ARCHIVE_LIST="$OUTPUT_DIR/archive-list.txt"

{
  echo "AICIS Lovable database export validation"
  echo "filename=$EXPORT_NAME"
  echo "bytes=$EXPORT_BYTES"
  echo "sha256=$EXPORT_SHA256"
  echo "file_type=$EXPORT_TYPE"
  echo "validated_at_utc=$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
} > "$SUMMARY"

# pg_restore --list is metadata-only. It does not emit table row contents.
if command -v pg_restore >/dev/null 2>&1 && pg_restore --list "$EXPORT_PATH" > "$MANIFEST" 2> "$OUTPUT_DIR/pg-restore.stderr"; then
  ENTRY_COUNT="$(grep -vcE '^(;|$)' "$MANIFEST" || true)"
  {
    echo "postgres_archive_parse=PASS"
    echo "postgres_archive_entries=$ENTRY_COUNT"
  } >> "$SUMMARY"
  rm -f "$OUTPUT_DIR/pg-restore.stderr"
else
  rm -f "$MANIFEST"
  echo "postgres_archive_parse=NOT_APPLICABLE_OR_FAILED" >> "$SUMMARY"

  case "$EXPORT_TYPE" in
    *Zip*|*ZIP*)
      if command -v unzip >/dev/null 2>&1; then
        unzip -Z1 "$EXPORT_PATH" > "$ARCHIVE_LIST"
        echo "container_listing=zip" >> "$SUMMARY"
      fi
      ;;
    *gzip*|*GZIP*)
      if command -v tar >/dev/null 2>&1 && tar -tzf "$EXPORT_PATH" > "$ARCHIVE_LIST" 2>/dev/null; then
        echo "container_listing=tar.gz" >> "$SUMMARY"
      else
        rm -f "$ARCHIVE_LIST"
        echo "container_listing=gzip-stream-or-unknown" >> "$SUMMARY"
      fi
      ;;
    *tar*)
      if command -v tar >/dev/null 2>&1 && tar -tf "$EXPORT_PATH" > "$ARCHIVE_LIST" 2>/dev/null; then
        echo "container_listing=tar" >> "$SUMMARY"
      fi
      ;;
    *text*|*ASCII*|*Unicode*|*UTF-8*)
      echo "container_listing=plain-text-possible-sql" >> "$SUMMARY"
      ;;
    *)
      echo "container_listing=unknown" >> "$SUMMARY"
      ;;
  esac
fi

printf '%s  %s\n' "$EXPORT_SHA256" "$EXPORT_NAME" > "$OUTPUT_DIR/${EXPORT_NAME}.sha256"

cat "$SUMMARY"
echo "Validation artifacts written to: $OUTPUT_DIR"
echo "No database row contents were printed or copied by this validator."
