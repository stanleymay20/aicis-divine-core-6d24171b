#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SOURCE_REF="${AICIS_SOURCE_PROJECT_REF:-psonnnuhjjskrdazrakk}"
TARGET_REF="${AICIS_TARGET_PROJECT_REF:-}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -n "$TARGET_REF" ]] || fail "AICIS_TARGET_PROJECT_REF is required"
[[ "$TARGET_REF" != "$SOURCE_REF" ]] || fail "Target project ref must differ from Lovable source ref"

CONFIG_REF="$(awk -F'"' '/^project_id[[:space:]]*=/{print $2; exit}' supabase/config.toml)"
[[ "$CONFIG_REF" == "$TARGET_REF" ]] || fail "supabase/config.toml still points to '$CONFIG_REF' instead of target '$TARGET_REF'"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Runtime/deployment surfaces must contain neither direct Lovable service bindings
# nor the source Supabase project ref. Historical SQL migrations and docs are
# intentionally excluded; restored cron jobs are rebound by target-only migration.
for path in src supabase/functions vite.config.ts netlify.toml public index.html; do
  [[ -e "$path" ]] || continue
  if [[ -d "$path" ]]; then
    grep -RInE \
      --exclude-dir=node_modules \
      --exclude-dir=.git \
      --exclude='*.map' \
      "${SOURCE_REF}|ai\\.gateway\\.lovable\\.dev|LOVABLE_API_KEY|@lovable\\.dev/cloud-auth-js|createLovableAuth|lovable-tagger" \
      "$path" >> "$TMP" || true
  else
    grep -nHE \
      "${SOURCE_REF}|ai\\.gateway\\.lovable\\.dev|LOVABLE_API_KEY|@lovable\\.dev/cloud-auth-js|createLovableAuth|lovable-tagger" \
      "$path" >> "$TMP" || true
  fi
done

sort -u "$TMP" -o "$TMP"
if [[ -s "$TMP" ]]; then
  echo "Runtime/deployment bindings that would break during a Lovable pause:" >&2
  cat "$TMP" >&2
  exit 1
fi

# Migration tooling required before a pause-ready certificate can be issued.
required_files=(
  scripts/aicis-backup.sh
  scripts/aicis-storage-backup.mjs
  scripts/aicis-migration-verify.sh
  scripts/aicis-source-inventory.sh
  migration/target/001_rebind_pipeline_cron.sql
)
for file in "${required_files[@]}"; do
  [[ -f "$file" ]] || fail "Required migration control missing: $file"
done

echo "PASS: static Lovable-pause readiness gate"
echo "source_project_ref=$SOURCE_REF"
echo "target_project_ref=$TARGET_REF"
echo "config_project_ref=$CONFIG_REF"
echo "NOTE: static readiness does not replace live source/target parity, provider freshness, Auth, Storage, cron, or function smoke tests."
