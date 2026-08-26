#!/usr/bin/env python3
"""Require the deferred privileged-auth manifest to match reality exactly.

This is not an authorization waiver. scripts/audit-edge-function-auth.py remains
fail-closed until the set reaches zero. This companion audit makes the temporary
pre-cutover blocker explicit and prevents any new unguarded privileged function
from being hidden inside the known migration hold set.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTH_AUDIT = ROOT / "scripts" / "audit-edge-function-auth.py"
MANIFEST = ROOT / "migration" / "target" / "cutover" / "privileged-auth-deferred.json"
FUNCTIONS = ROOT / "supabase" / "functions"
APPROVED_TARGET_REF = "qpphncfgbhizvnovzivw"
SOURCE_REF = "psonnnuhjjskrdazrakk"


def load_auth_audit_module():
    spec = importlib.util.spec_from_file_location("aicis_edge_auth_audit", AUTH_AUDIT)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load edge auth audit module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def actual_unguarded(module) -> set[str]:
    result: set[str] = set()
    for path in sorted(FUNCTIONS.glob("*/index.ts")):
        source = path.read_text(encoding="utf-8")
        if "SUPABASE_SERVICE_ROLE_KEY" in source and not module.has_caller_validation(source):
            result.add(path.parent.name)
    return result


errors: list[str] = []
if not MANIFEST.exists():
    print(f"FAIL: missing deferred auth manifest: {MANIFEST.relative_to(ROOT)}")
    raise SystemExit(1)

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
entries = manifest.get("functions")
if not isinstance(entries, list):
    print("FAIL: manifest functions must be an array")
    raise SystemExit(1)

names = [entry.get("name") for entry in entries if isinstance(entry, dict)]
if len(names) != len(entries) or any(not isinstance(name, str) or not name for name in names):
    errors.append("every manifest function entry must have a non-empty string name")
if len(names) != len(set(names)):
    errors.append("manifest contains duplicate function names")

if manifest.get("approved_target_ref") != APPROVED_TARGET_REF:
    errors.append("manifest approved_target_ref does not match aicis-production")
if manifest.get("source_ref") != SOURCE_REF:
    errors.append("manifest source_ref does not match the preserved Lovable source")

allowed_intents = {
    "admin_or_trusted_worker",
    "signed_webhook_or_trusted_worker",
}
for entry in entries:
    if not isinstance(entry, dict):
        continue
    name = entry.get("name", "<unknown>")
    if entry.get("target_auth_intent") not in allowed_intents:
        errors.append(f"{name}: unsupported or missing target_auth_intent")
    if not entry.get("source_caller_state"):
        errors.append(f"{name}: missing source_caller_state")
    if not entry.get("evidence"):
        errors.append(f"{name}: missing evidence")
    if not entry.get("cutover_requirement"):
        errors.append(f"{name}: missing cutover_requirement")

module = load_auth_audit_module()
actual = actual_unguarded(module)
expected = set(names)

new_holes = sorted(actual - expected)
resolved_but_stale = sorted(expected - actual)
if new_holes:
    errors.append("new unguarded privileged functions not in manifest: " + ",".join(new_holes))
if resolved_but_stale:
    errors.append("manifest still lists functions that are now guarded: " + ",".join(resolved_but_stale))

print("AICIS deferred privileged-auth manifest audit")
print(f"manifest_count={len(expected)}")
print(f"actual_unguarded_count={len(actual)}")
if actual:
    print("deferred=" + ",".join(sorted(actual)))

if errors:
    for error in errors:
        print(f"FAIL: {error}")
    sys.exit(1)

print("PASS: deferred manifest exactly matches the current privileged-auth blocker set")
print("NOTICE: this does not waive the primary privileged-auth gate; cutover still requires actual_unguarded_count=0")
