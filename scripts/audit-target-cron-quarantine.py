#!/usr/bin/env python3
"""Fail closed if restore-phase target SQL can activate cron writers.

Restore/shadow migrations live directly under migration/target/*.sql and must
never call cron.schedule(). Cutover SQL may be either:

1. an explicitly fail-closed placeholder that schedules zero jobs while source
   scheduler decisions are incomplete; or
2. a real activation migration that is target-pinned, requires a clean
   quarantine and uses the target-safe invocation helper.

A fail-closed placeholder is safer than retaining a stale partial activation
wave after new source evidence changes the scheduler model.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "migration" / "target"
QUARANTINE = TARGET / "001_rebind_pipeline_cron.sql"
CUTOVER_DIR = TARGET / "cutover"
APPROVED_TARGET_REF = "qpphncfgbhizvnovzivw"
SOURCE_REFS = (
    "psonnnuhjjskrdazrakk",  # verified current AICIS source runtime binding
    "itpwpnwzzitkelffttyx",  # observed external/legacy Quantivis bridge binding; never a target destination
)
FAIL_CLOSED_MARKER = "AICIS cutover blocked:"


def without_line_comments(text: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in text.splitlines())


def has_schedule(text: str) -> bool:
    return re.search(r"\bcron\s*\.\s*schedule\s*\(", without_line_comments(text), re.I) is not None


def require_source_guards(text: str, context: str, errors: list[str]) -> None:
    for source_ref in SOURCE_REFS:
        if source_ref not in text:
            errors.append(f"{context} lacks explicit guarded-ref rejection for {source_ref}")


errors: list[str] = []
restore_files = sorted(TARGET.glob("*.sql"))
if not restore_files:
    errors.append("no restore-phase target SQL files found")

for path in restore_files:
    text = path.read_text(encoding="utf-8")
    if has_schedule(text):
        errors.append(f"restore-phase file activates cron: {path.relative_to(ROOT)}")

if not QUARANTINE.exists():
    errors.append(f"missing quarantine migration: {QUARANTINE.relative_to(ROOT)}")
else:
    quarantine_text = QUARANTINE.read_text(encoding="utf-8")
    normalized = re.sub(r"\s+", " ", without_line_comments(quarantine_text)).lower()
    if "update cron.job set active = false where active;" not in normalized:
        errors.append("quarantine migration does not disable every active restored cron job")
    if "invoke_aicis_edge_function" not in quarantine_text:
        errors.append("quarantine migration is missing the target-safe Edge Function helper")
    require_source_guards(quarantine_text, "quarantine migration", errors)

cutover_files = sorted(CUTOVER_DIR.glob("*.sql")) if CUTOVER_DIR.exists() else []
if not cutover_files:
    errors.append("no explicit cutover control migration found")

fail_closed_files = 0
activation_files = 0
for path in cutover_files:
    text = path.read_text(encoding="utf-8")
    normalized = re.sub(r"\s+", " ", without_line_comments(text)).lower()
    schedules = has_schedule(text)
    fail_closed = FAIL_CLOSED_MARKER.lower() in text.lower() and "raise exception" in normalized

    if fail_closed:
        fail_closed_files += 1
        if schedules:
            errors.append(f"fail-closed cutover file must schedule zero jobs: {path.relative_to(ROOT)}")
        continue

    activation_files += 1
    if not schedules:
        errors.append(f"cutover activation file contains no explicit cron activation: {path.relative_to(ROOT)}")
    if APPROVED_TARGET_REF not in text:
        errors.append(f"cutover activation file does not pin the approved target ref: {path.relative_to(ROOT)}")
    require_source_guards(text, f"cutover activation file {path.relative_to(ROOT)}", errors)
    if "invoke_aicis_edge_function" not in text:
        errors.append(f"cutover activation file bypasses the target-safe invocation helper: {path.relative_to(ROOT)}")
    if "if exists (select 1 from cron.job where active)" not in normalized:
        errors.append(f"cutover activation file does not require a clean cron quarantine: {path.relative_to(ROOT)}")

print("AICIS target cron quarantine audit")
print(f"restore_phase_files={len(restore_files)}")
print(f"cutover_files={len(cutover_files)}")
print(f"fail_closed_cutover_files={fail_closed_files}")
print(f"activation_cutover_files={activation_files}")
print(f"guarded_refs={','.join(SOURCE_REFS)}")

if errors:
    for error in errors:
        print(f"FAIL: {error}")
    sys.exit(1)

print("PASS: restore-phase target SQL activates zero cron writers")
if activation_files:
    print("PASS: cutover activation SQL is isolated, target-pinned, and rejects guarded refs")
if fail_closed_files:
    print("PASS: incomplete scheduler parity is represented by an executable fail-closed cutover barrier")
