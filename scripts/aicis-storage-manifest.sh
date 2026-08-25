#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <downloaded-storage-root> [manifest-file]" >&2
  exit 64
fi

ROOT="$1"
MANIFEST="${2:-artifacts/aicis-storage-manifest.tsv}"

if [[ ! -d "$ROOT" ]]; then
  echo "Storage directory not found: $ROOT" >&2
  exit 66
fi

mkdir -p "$(dirname "$MANIFEST")"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

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

printf 'relative_path\tbytes\tsha256\n' > "$TMP"

while IFS= read -r -d '' file_path; do
  relative_path="${file_path#"$ROOT"/}"
  bytes="$(file_size "$file_path")"
  digest="$(sha256_file "$file_path")"
  printf '%s\t%s\t%s\n' "$relative_path" "$bytes" "$digest" >> "$TMP"
done < <(find "$ROOT" -type f -print0 | sort -z)

mv "$TMP" "$MANIFEST"
trap - EXIT

OBJECT_COUNT="$(( $(wc -l < "$MANIFEST") - 1 ))"
TOTAL_BYTES="$(awk -F '\t' 'NR>1 {sum += $2} END {printf "%.0f", sum+0}' "$MANIFEST")"

printf 'storage_objects=%s\n' "$OBJECT_COUNT"
printf 'storage_bytes=%s\n' "$TOTAL_BYTES"
printf 'manifest=%s\n' "$MANIFEST"
echo "Manifest contains only paths, byte sizes and SHA-256 values; object contents are not printed."
