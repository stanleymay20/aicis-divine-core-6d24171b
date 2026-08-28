#!/usr/bin/env python3
"""Validate AICIS live-source cron preservation decisions.

Default mode is a structural pre-cutover audit. It verifies that any *verified*
AICIS live-source cron set is complete, unique and explicitly classified, that
source Edge Function targets exist in the repository when applicable, and that
every job scheduled by the cutover SQL is represented as an approved target
action.

Cross-project or otherwise invalidated observations are not counted as AICIS
source evidence. If the manifest says the current AICIS source inventory is not
verified, structural CI may pass while cutover remains explicitly blocked.

--cutover-ready is intentionally stricter. It fails while the current AICIS
source inventory is unverified, any verified source job remains pending, lacks
a captured source schedule, has no repository implementation for an Edge
Function target, or is missing an explicit activate/replace/retire decision.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "migration" / "target" / "cutover" / "live-source-cron-decisions.json"
CUTOVER_SQL = ROOT / "migration" / "target" / "cutover" / "001_activate_audited_cron.sql"
FUNCTIONS_DIR = ROOT / "supabase" / "functions"

ALLOWED_SOURCE_DECISIONS = {"pending", "activate", "replace", "retire"}
ALLOWED_TARGET_DECISIONS = {"approved_target_only"}
VERIFIED_SOURCE_STATUS = "verified_current_aicis_source"


def scheduled_jobnames(sql: str) -> set[str]:
    return set(
        re.findall(
            r"cron\s*\.\s*schedule\s*\(\s*'([^']+)'",
            sql,
            flags=re.IGNORECASE | re.MULTILINE,
        )
    )


def edge_function_exists(target: str | None) -> bool | None:
    if not target:
        return False
    if target.startswith("public."):
        return None
    return (FUNCTIONS_DIR / target / "index.ts").exists()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutover-ready", action="store_true")
    args = parser.parse_args()

    errors: list[str] = []
    blockers: list[str] = []
    missing_repo_targets: list[str] = []

    if not MANIFEST.exists():
        print(f"FAIL: missing cron decision manifest: {MANIFEST.relative_to(ROOT)}")
        return 1
    if not CUTOVER_SQL.exists():
        print(f"FAIL: missing cutover SQL: {CUTOVER_SQL.relative_to(ROOT)}")
        return 1

    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    jobs = data.get("jobs", [])
    observed_expected = data.get("observed_source_job_count")
    source_inventory_status = data.get("source_inventory_status")

    source_jobs = [j for j in jobs if j.get("origin") == "live_source"]
    target_jobs = [j for j in jobs if j.get("origin") == "target_new"]

    source_names = [j.get("source_jobname") for j in source_jobs]
    target_names = [j.get("target_jobname") for j in target_jobs]

    if source_inventory_status != VERIFIED_SOURCE_STATUS:
        blockers.append(
            "current AICIS source cron inventory is not verified; cross-project/invalidated observations cannot satisfy parity"
        )

    if observed_expected != len(source_jobs):
        errors.append(
            f"observed_source_job_count={observed_expected} but manifest contains {len(source_jobs)} live_source entries"
        )
    if len(source_names) != len(set(source_names)):
        errors.append("duplicate live source jobname in manifest")
    if len(target_names) != len(set(target_names)):
        errors.append("duplicate target_new jobname in manifest")

    for job in source_jobs:
        name = job.get("source_jobname") or "<missing>"
        target = job.get("source_target")
        if not job.get("source_jobname"):
            errors.append("live_source entry missing source_jobname")
        if job.get("source_active") is not True:
            errors.append(f"{name}: observed source job is not explicitly marked active=true")
        decision = job.get("decision")
        if decision not in ALLOWED_SOURCE_DECISIONS:
            errors.append(f"{name}: invalid source decision {decision!r}")
        if decision in {"activate", "replace"}:
            if not job.get("target_jobname"):
                errors.append(f"{name}: {decision} requires target_jobname")
            if not job.get("target_target"):
                errors.append(f"{name}: {decision} requires target_target")
        if decision == "retire" and not job.get("rationale"):
            errors.append(f"{name}: retire requires rationale")

        implementation = edge_function_exists(target)
        if implementation is False:
            missing_repo_targets.append(f"{name}->{target}")
            blockers.append(f"{name}: repository Edge Function target {target!r} is missing")

        if decision == "pending":
            blockers.append(f"{name}: decision pending")
        if job.get("source_schedule") is None:
            blockers.append(f"{name}: source schedule not yet captured")

    for job in target_jobs:
        name = job.get("target_jobname") or "<missing>"
        target = job.get("target_target")
        if not job.get("target_jobname"):
            errors.append("target_new entry missing target_jobname")
        if job.get("decision") not in ALLOWED_TARGET_DECISIONS:
            errors.append(f"{name}: invalid target_new decision {job.get('decision')!r}")
        if not target:
            errors.append(f"{name}: target_new entry missing target_target")
        elif not (FUNCTIONS_DIR / target / "index.ts").exists():
            errors.append(f"{name}: approved target-only Edge Function {target!r} does not exist in repository")
        if not job.get("rationale"):
            errors.append(f"{name}: target_new entry missing rationale")

    sql_jobs = scheduled_jobnames(CUTOVER_SQL.read_text(encoding="utf-8"))
    approved_target_names = {
        j.get("target_jobname")
        for j in target_jobs
        if j.get("decision") == "approved_target_only"
    }
    approved_source_names = {
        j.get("target_jobname")
        for j in source_jobs
        if j.get("decision") in {"activate", "replace"}
    }
    approved_for_cutover = approved_target_names | approved_source_names

    unmanifested_sql_jobs = sorted(sql_jobs - approved_for_cutover)
    if unmanifested_sql_jobs:
        errors.append(
            "cutover SQL schedules jobs without an approved manifest decision: "
            + ", ".join(unmanifested_sql_jobs)
        )

    manifest_but_unscheduled = sorted(approved_for_cutover - sql_jobs)
    if manifest_but_unscheduled:
        errors.append(
            "manifest approves target activation absent from cutover SQL: "
            + ", ".join(manifest_but_unscheduled)
        )

    print("AICIS live-source cron parity audit")
    print(f"source_inventory_status={source_inventory_status}")
    print(f"observed_live_source_jobs={len(source_jobs)}")
    print(f"approved_target_only_jobs={len(target_jobs)}")
    print(f"cutover_sql_scheduled_jobs={len(sql_jobs)}")
    print(f"missing_repository_source_targets={len(missing_repo_targets)}")
    if missing_repo_targets:
        print("missing_repository_source_target_names=" + ",".join(sorted(missing_repo_targets)))
    print(f"cutover_blockers={len(blockers)}")

    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1

    if args.cutover_ready and blockers:
        for blocker in blockers:
            print(f"BLOCKER: {blocker}")
        print("FAIL: live-source cron preservation is not cutover-ready")
        return 1

    if blockers:
        print(
            "PASS: structural cron manifest is internally consistent; cutover remains blocked until "
            "the current AICIS source inventory is verified and all required source jobs are classified"
        )
    else:
        print("PASS: live-source cron preservation decisions are complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
