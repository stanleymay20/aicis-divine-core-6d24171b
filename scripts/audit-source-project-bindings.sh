#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fail closed across both forbidden destination refs, while preserving their
# distinct evidence semantics:
# - ps... is the verified current AICIS source runtime binding.
# - it... is observed in legacy/external Quantivis bridge functions in the
#   AICIS database and must never become an AICIS target destination.
DEFAULT_SOURCE_REFS=(
  "psonnnuhjjskrdazrakk"
  "itpwpnwzzitkelffttyx"
)

if [[ -n "${AICIS_SOURCE_PROJECT_REFS:-}" ]]; then
  IFS=',' read -r -a SOURCE_REFS <<< "$AICIS_SOURCE_PROJECT_REFS"
elif [[ -n "${AICIS_SOURCE_PROJECT_REF:-}" ]]; then
  SOURCE_REFS=("$AICIS_SOURCE_PROJECT_REF")
else
  SOURCE_REFS=("${DEFAULT_SOURCE_REFS[@]}")
fi

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
  local ref path
  for ref in "${SOURCE_REFS[@]}"; do
    [[ -n "$ref" ]] || continue
    for path in "$@"; do
      [[ -e "$path" ]] || continue
      grep -RInF \
        --exclude-dir=node_modules \
        --exclude='*.map' \
        "$ref" "$path" >> "$output" || true
    done
  done
  sort -u "$output" -o "$output"
}

# Strict surface: code and deployable frontend assets that can make live calls.
# Historical SQL is deliberately NOT included here because old migrations must
# remain available as evidence and can legitimately contain guarded refs.
scan_paths "$RUNTIME_TMP" \
  supabase/functions \
  src \
  public \
  index.html \
  vite.config.ts \
  netlify.toml

# Informational evidence only. Target-only control SQL can also mention guarded
# refs specifically to disable/reject restored source/external-bound jobs.
scan_paths "$HISTORICAL_TMP" \
  supabase/migrations \
  migration/target \
  docs \
  .lovable

# supabase/config.toml intentionally remains source-bound until the independent
# target has been restored and smoke-tested. The final pause-readiness gate
# separately requires project_id to equal the target ref before cutover.
if [[ -f supabase/config.toml ]]; then
  for ref in "${SOURCE_REFS[@]}"; do
    [[ -n "$ref" ]] || continue
    grep -nF "$ref" supabase/config.toml >> "$CONFIG_TMP" || true
  done
  sort -u "$CONFIG_TMP" -o "$CONFIG_TMP"
fi

RUNTIME_COUNT="$(wc -l < "$RUNTIME_TMP" | tr -d ' ')"
HISTORICAL_COUNT="$(wc -l < "$HISTORICAL_TMP" | tr -d ' ')"
CONFIG_COUNT="$(wc -l < "$CONFIG_TMP" | tr -d ' ')"

echo "AICIS guarded-project binding audit"
echo "guarded_project_refs=$(IFS=,; echo "${SOURCE_REFS[*]}")"
echo "runtime_bindings=$RUNTIME_COUNT"
echo "historical_or_control_bindings=$HISTORICAL_COUNT"
echo "config_bindings=$CONFIG_COUNT"

if [[ "$RUNTIME_COUNT" -gt 0 ]]; then
  echo
  echo "Executable/runtime bindings:"
  cat "$RUNTIME_TMP"
  echo
  echo "Destination cutover is blocked until every executable guarded binding above is removed."
  if [[ "$STRICT" == "true" ]]; then
    exit 1
  fi
else
  echo "PASS: no executable guarded-project bindings found."
fi

if [[ "$CONFIG_COUNT" -gt 0 ]]; then
  echo
  echo "NOTICE: supabase/config.toml still references a guarded project."
  echo "This is expected before target restore/smoke testing and must change before cutover."
fi

if [[ "$HISTORICAL_COUNT" -gt 0 ]]; then
  echo
  echo "Historical/control references retained for audit: $HISTORICAL_COUNT"
fi
