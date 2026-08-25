#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="report"
case "${1:-}" in
  --strict) MODE="strict" ;;
  --migration-gate) MODE="migration_gate" ;;
  "") ;;
  *) echo "Usage: $0 [--strict|--migration-gate]" >&2; exit 2 ;;
esac

PATTERN='ai\.gateway\.lovable\.dev|LOVABLE_API_KEY|@lovable\.dev/cloud-auth-js|createLovableAuth|lovable-tagger'
RUNTIME_PATHS=(src supabase/functions vite.config.ts package.json)

# Temporary migration allowlist. Only the final AICIS intelligence surface remains.
# Remove this path and switch CI to --strict as soon as it is converted.
MIGRATION_ALLOWLIST=(
  "supabase/functions/aicis-intelligence/index.ts"
)

TMP="$(mktemp)"
UNEXPECTED="$(mktemp)"
trap 'rm -f "$TMP" "$UNEXPECTED"' EXIT

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

if [[ "$COUNT" -eq 0 ]]; then
  echo "No direct Lovable runtime dependencies found."
  exit 0
fi

cat "$TMP"
echo

if [[ "$MODE" == "strict" ]]; then
  echo "AICIS is NOT Lovable-runtime-independent."
  exit 1
fi

if [[ "$MODE" == "migration_gate" ]]; then
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    file="${match%%:*}"
    allowed=false
    for exception in "${MIGRATION_ALLOWLIST[@]}"; do
      if [[ "$file" == "$exception" ]]; then
        allowed=true
        break
      fi
    done
    if [[ "$allowed" != "true" ]]; then
      printf '%s\n' "$match" >> "$UNEXPECTED"
    fi
  done < "$TMP"

  if [[ -s "$UNEXPECTED" ]]; then
    echo "Unexpected Lovable runtime dependency outside migration allowlist:"
    cat "$UNEXPECTED"
    exit 1
  fi

  echo "Migration gate passed: all remaining runtime matches are confined to the explicit allowlist."
  printf 'Allowed files remaining:\n'
  printf ' - %s\n' "${MIGRATION_ALLOWLIST[@]}"
  exit 0
fi

echo "AICIS is NOT yet Lovable-runtime-independent."
