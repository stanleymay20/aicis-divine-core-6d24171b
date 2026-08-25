#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Runtime dependency means code/config that is imported or executed by the deployed app.
# package.json/bun.lock are reported separately because an installed-but-unused package does
# not create a live Lovable dependency and must be removed together with the lockfile.
PATTERN='ai\.gateway\.lovable\.dev|LOVABLE_API_KEY|@lovable\.dev/cloud-auth-js|createLovableAuth|lovable-tagger'
RUNTIME_PATHS=(src supabase/functions vite.config.ts)
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
    grep -nHE "$PATTERN" "$path" >> "$TMP" || true
  fi
done

sort -u "$TMP" -o "$TMP"
COUNT="$(wc -l < "$TMP" | tr -d ' ')"

echo "AICIS Lovable runtime dependency audit"
echo "runtime_matches=$COUNT"

if [[ "$COUNT" -gt 0 ]]; then
  cat "$TMP"
  echo
  echo "AICIS runtime still contains a direct Lovable dependency."
  exit 1
fi

echo "PASS: zero direct Lovable runtime dependencies found."

if grep -Eq '"@lovable\.dev/cloud-auth-js"|"lovable-tagger"' package.json 2>/dev/null; then
  echo "NOTICE: unused Lovable packages remain in package.json/bun.lock pending atomic lockfile cleanup."
fi
