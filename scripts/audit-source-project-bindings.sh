#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SOURCE_REF="${AICIS_SOURCE_PROJECT_REF:-psonnnuhjjskrdazrakk}"
STRICT=false
if [[ "${1:-}" == "--strict" ]]; then
  STRICT=true
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Search only executable/deployable source surfaces. Historical documentation,
# backup manifests and target-only migration assets are intentionally excluded.
for path in supabase/functions supabase/migrations src; do
  [[ -e "$path" ]] || continue
  grep -RInF \
    --exclude-dir=node_modules \
    --exclude='*.map' \
    "$SOURCE_REF" "$path" >> "$TMP" || true
done

sort -u "$TMP" -o "$TMP"
COUNT="$(wc -l < "$TMP" | tr -d ' ')"

echo "AICIS source-project binding audit"
echo "source_project_ref=$SOURCE_REF"
echo "runtime_bindings=$COUNT"

if [[ "$COUNT" -gt 0 ]]; then
  echo
  cat "$TMP"
  echo
  echo "Destination cutover is blocked until every executable binding above is"
  echo "either removed or explicitly rebound by a target-only migration."
  if [[ "$STRICT" == "true" ]]; then
    exit 1
  fi
else
  echo "No executable source-project bindings found."
fi
