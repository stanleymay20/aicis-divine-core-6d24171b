#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STRICT=false
if [[ "${1:-}" == "--strict" ]]; then
  STRICT=true
fi

PATTERN='ai\.gateway\.lovable\.dev|LOVABLE_API_KEY|@lovable\.dev/cloud-auth-js|createLovableAuth|lovable-tagger'

# Runtime-bearing paths only. Historical planning/memory/docs are intentionally
# excluded because they do not make the deployed application depend on Lovable.
RUNTIME_PATHS=(src supabase/functions vite.config.ts package.json)

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for path in "${RUNTIME_PATHS[@]}"; do
  [[ -e "$path" ]] || continue
  if [[ -d "$path" ]]; then
    grep -RInE \
      --exclude-dir=node_modules \
      --exclude-dir=.git \
      --exclude='*.map' \
      "$PATTERN" "$path" >> "$TMP" || true
  else
    grep -nE "$PATTERN" "$path" >> "$TMP" || true
  fi
done

sort -u "$TMP" -o "$TMP"
COUNT="$(wc -l < "$TMP" | tr -d ' ')"

echo "AICIS Lovable runtime dependency audit"
echo "runtime_matches=$COUNT"

if [[ "$COUNT" -gt 0 ]]; then
  echo
  cat "$TMP"
  echo
  echo "AICIS is NOT yet Lovable-runtime-independent."
  if [[ "$STRICT" == "true" ]]; then
    exit 1
  fi
else
  echo "No direct Lovable runtime dependencies found."
fi
