#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SOURCE_REF="${AICIS_SOURCE_PROJECT_REF:-psonnnuhjjskrdazrakk}"
STRICT=false
if [[ "${1:-}" == "--strict" ]]; then
  STRICT=true
fi

RUNTIME_TMP="$(mktemp)"
HISTORICAL_TMP="$(mktemp)"
CONFIG_TMP="$(mktemp)"
trap 'rm -f "$RUNTIME_TMP" "$HISTORICAL_TMP" "$CONFIG_TMP"' EXIT

scan_paths() {
  local output="$1"
  shift
  local path
  for path in "$@"; do
    [[ -e "$path" ]] || continue
    grep -RInF \
      --exclude-dir=node_modules \
      --exclude='*.map' \
      "$SOURCE_REF" "$path" >> "$output" || true
  done
  sort -u "$output" -o "$output"
}

# Strict surface: code and deployable frontend assets that can make live calls.
# Historical SQL is deliberately NOT included here because old migrations must
# remain available as evidence and can legitimately contain the source ref.
scan_paths "$RUNTIME_TMP" \
  supabase/functions \
  src \
  public \
  index.html \
  vite.config.ts \
  netlify.toml

# Informational evidence only. Target-only control SQL can also mention the
# source ref specifically to disable/reject restored source-bound jobs.
scan_paths "$HISTORICAL_TMP" \
  supabase/migrations \
  migration/target \
  docs \
  .lovable

# supabase/config.toml intentionally remains source-bound until the independent
# target has been restored and smoke-tested. The final pause-readiness gate
# separately requires project_id to equal the target ref before cutover.
if [[ -f supabase/config.toml ]]; then
  grep -nF "$SOURCE_REF" supabase/config.toml > "$CONFIG_TMP" || true
fi

RUNTIME_COUNT="$(wc -l < "$RUNTIME_TMP" | tr -d ' ')"
HISTORICAL_COUNT="$(wc -l < "$HISTORICAL_TMP" | tr -d ' ')"
CONFIG_COUNT="$(wc -l < "$CONFIG_TMP" | tr -d ' ')"

echo "AICIS source-project binding audit"
echo "source_project_ref=$SOURCE_REF"
echo "runtime_bindings=$RUNTIME_COUNT"
echo "historical_or_control_bindings=$HISTORICAL_COUNT"
echo "config_bindings=$CONFIG_COUNT"

if [[ "$RUNTIME_COUNT" -gt 0 ]]; then
  echo
  echo "Executable/runtime bindings:"
  cat "$RUNTIME_TMP"
  echo
  echo "Destination cutover is blocked until every executable binding above is removed."
  if [[ "$STRICT" == "true" ]]; then
    exit 1
  fi
else
  echo "PASS: no executable source-project bindings found."
fi

if [[ "$CONFIG_COUNT" -gt 0 ]]; then
  echo
  echo "NOTICE: supabase/config.toml still references the source project."
  echo "This is expected before target restore/smoke testing and must change before cutover."
fi

if [[ "$HISTORICAL_COUNT" -gt 0 ]]; then
  echo
  echo "Historical/control references retained for audit: $HISTORICAL_COUNT"
fi
