#!/usr/bin/env python3
"""Validate AICIS source scheduler preservation without trusting stale inventories.

The verified source schedule lives in a separate sanitized snapshot. Raw cron
commands are intentionally excluded from Git. The decision manifest classifies
source jobs and separately records target-only designs.

Default mode validates structural consistency and is allowed to pass while
cutover blockers remain. --cutover-ready fails until every active verified
source job is explicitly activate/replace/retire, every activation is represented
in cutover SQL, and every target-only job is separately activation-approved.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "migration" / "target" / "cutover" / "live-source-cron-decisions.json"
CUTOVER_SQL = ROOT / "migration" / "target" / "cutover" / "001_activate_audited_cron.sql"
FUNCTIONS_DIR = ROOT / "supabase" / "functions"
VERIFIED_SOURCE_STATUS = "verified_current_aicis_source"
ALLOWED_SOURCE_DECISIONS = {"activate", "replace", "retire"}


def scheduled_jobnames(sql: str) -> set[str]:
    return set(re.findall(r"cron\s*\.\s*schedule\s*\(\s*'([^']+)'", sql, re.I | re.M))


def snapshot_md5(rows: list[list[object]]) -> str:
    text = "\n".join(
        f"{int(row[0])}\t{row[1]}\t{row[2]}\t{str(bool(row[3])).lower()}"
        for row in rows
    )
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutover-ready", action="store_true")
    args = parser.parse_args()

    errors: list[str] = []
    blockers: list[str] = []

    if not MANIFEST.exists() or not CUTOVER_SQL.exists():
        print("FAIL: missing cron migration control file")
        return 1

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    snapshot_rel = manifest.get("source_snapshot")
    if not snapshot_rel:
        print("FAIL: decision manifest does not reference a source snapshot")
        return 1
    snapshot_path = ROOT / snapshot_rel
    if not snapshot_path.exists():
        print(f"FAIL: source snapshot missing: {snapshot_rel}")
        return 1

    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows = snapshot.get("jobs", [])
    source_status = manifest.get("source_inventory_status")
    expected_count = manifest.get("observed_source_job_count")
    expected_active = manifest.get("active_source_job_count")

    names = [row[1] for row in rows if isinstance(row, list) and len(row) == 4]
    active_rows = [row for row in rows if isinstance(row, list) and len(row) == 4 and row[3] is True]
    active_names = {row[1] for row in active_rows}

    if source_status != VERIFIED_SOURCE_STATUS:
        blockers.append("current AICIS source cron inventory is not verified")
    if len(rows) != expected_count or snapshot.get("cron_jobs") != expected_count:
        errors.append(f"source job count mismatch: snapshot={len(rows)} manifest={expected_count}")
    if len(active_rows) != expected_active or snapshot.get("active_cron_jobs") != expected_active:
        errors.append(f"active source job count mismatch: snapshot={len(active_rows)} manifest={expected_active}")
    if len(names) != len(set(names)):
        errors.append("duplicate source job name in verified snapshot")
    if snapshot.get("cron_schedule_md5") != snapshot_md5(rows):
        errors.append("verified source cron schedule fingerprint mismatch")
    if snapshot.get("lovable_project_id") != manifest.get("aicis_source_project_id"):
        errors.append("source project identity mismatch between snapshot and decision manifest")

    decisions = manifest.get("source_decisions", [])
    decision_by_source: dict[str, dict[str, object]] = {}
    for decision in decisions:
        source_name = decision.get("source_jobname")
        if not source_name:
            errors.append("source decision missing source_jobname")
            continue
        if source_name in decision_by_source:
            errors.append(f"duplicate source decision: {source_name}")
            continue
        if source_name not in set(names):
            errors.append(f"source decision references job absent from verified snapshot: {source_name}")
        if decision.get("decision") not in ALLOWED_SOURCE_DECISIONS:
            errors.append(f"{source_name}: invalid decision {decision.get('decision')!r}")
        if decision.get("decision") in {"activate", "replace"}:
            target_name = decision.get("target_jobname")
            target_target = decision.get("target_target")
            if not target_name or not target_target:
                errors.append(f"{source_name}: activate/replace requires target_jobname and target_target")
            elif not str(target_target).startswith("public.") and not (FUNCTIONS_DIR / str(target_target) / "index.ts").exists():
                blockers.append(f"{source_name}: target implementation missing: {target_target}")
        if decision.get("decision") == "retire" and not decision.get("rationale"):
            errors.append(f"{source_name}: retire requires rationale")
        decision_by_source[str(source_name)] = decision

    unclassified_active = sorted(active_names - set(decision_by_source))
    if unclassified_active:
        blockers.append(f"{len(unclassified_active)} active source jobs remain unclassified")

    # Inactive source jobs do not require production activation, but a final
    # cutover ledger should still explain them for complete scheduler parity.
    inactive_names = set(names) - active_names
    unclassified_inactive = sorted(inactive_names - set(decision_by_source))
    if unclassified_inactive:
        blockers.append(f"{len(unclassified_inactive)} inactive source jobs remain unclassified")

    target_jobs = manifest.get("target_new_jobs", [])
    target_names: set[str] = set()
    activation_approved_target: set[str] = set()
    for job in target_jobs:
        name = job.get("target_jobname")
        target = job.get("target_target")
        if not name or not target:
            errors.append("target_new job missing name or target")
            continue
        if name in target_names:
            errors.append(f"duplicate target_new job: {name}")
        target_names.add(str(name))
        if not (FUNCTIONS_DIR / str(target) / "index.ts").exists():
            errors.append(f"target_new implementation missing: {target}")
        if job.get("decision") != "approved_target_only":
            errors.append(f"{name}: invalid target-only design decision")
        if job.get("activation_approved") is True:
            activation_approved_target.add(str(name))
        else:
            blockers.append(f"target-only job {name} is not activation-approved")

    sql = CUTOVER_SQL.read_text(encoding="utf-8")
    sql_jobs = scheduled_jobnames(sql)
    activation_approved_source = {
        str(d.get("target_jobname"))
        for d in decisions
        if d.get("decision") in {"activate", "replace"} and d.get("activation_approved") is True
    }
    allowed_sql_jobs = activation_approved_source | activation_approved_target

    unexpected_sql = sorted(sql_jobs - allowed_sql_jobs)
    if unexpected_sql:
        errors.append("cutover SQL schedules unapproved jobs: " + ", ".join(unexpected_sql))
    approved_but_unscheduled = sorted(allowed_sql_jobs - sql_jobs)
    if approved_but_unscheduled:
        errors.append("activation-approved jobs absent from cutover SQL: " + ", ".join(approved_but_unscheduled))

    if not sql_jobs:
        blockers.append("cutover SQL intentionally schedules zero jobs")

    print("AICIS live-source cron parity audit")
    print(f"source_inventory_status={source_status}")
    print(f"verified_source_jobs={len(rows)}")
    print(f"verified_active_source_jobs={len(active_rows)}")
    print(f"source_decisions={len(decisions)}")
    print(f"unclassified_active_source_jobs={len(unclassified_active)}")
    print(f"target_new_jobs={len(target_jobs)}")
    print(f"cutover_sql_scheduled_jobs={len(sql_jobs)}")
    print(f"cutover_blockers={len(blockers)}")

    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1

    if args.cutover_ready and blockers:
        for blocker in blockers:
            print(f"BLOCKER: {blocker}")
        print("FAIL: verified AICIS scheduler is not cutover-ready")
        return 1

    if blockers:
        print("PASS: verified source cron evidence is structurally consistent; cutover remains fail-closed")
    else:
        print("PASS: source scheduler decisions and cutover activation are complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
