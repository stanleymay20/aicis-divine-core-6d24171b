#!/usr/bin/env python3
"""Fail CI when a post-truth-floor migration replaces an existing view without DROP.

PostgreSQL CREATE OR REPLACE VIEW cannot remove, rename, reorder, or change the type
of existing output columns. Application lint/build gates do not execute migration
DDL, so an unsafe view replacement can remain invisible until a target restore.

From the 2026-08-28 truth-floor baseline onward AICIS uses a conservative rule:
if a view already exists earlier in migration order, a later CREATE OR REPLACE VIEW
must be preceded by an explicit DROP VIEW. The following migration can then recreate
whatever evidence-aware shape it needs deterministically.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

BASELINE = "20260828000000"
MIGRATION_DIR = Path("supabase/migrations")

COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
COMMENT_LINE_RE = re.compile(r"--[^\n]*")
TOKEN_RE = re.compile(
    r"(?P<drop>\bDROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:(?:public)\.)?(?P<drop_name>\"?[A-Za-z_][A-Za-z0-9_]*\"?))"
    r"|"
    r"(?P<create>\bCREATE\s+(?P<replace>OR\s+REPLACE\s+)?VIEW\s+(?:(?:public)\.)?(?P<create_name>\"?[A-Za-z_][A-Za-z0-9_]*\"?))",
    re.IGNORECASE,
)


def normalize(name: str) -> str:
    return name.strip('"').lower()


def strip_comments(sql: str) -> str:
    sql = COMMENT_BLOCK_RE.sub("", sql)
    return COMMENT_LINE_RE.sub("", sql)


def main() -> int:
    if not MIGRATION_DIR.is_dir():
        print(f"ERROR: migration directory not found: {MIGRATION_DIR}")
        return 2

    migrations = sorted(MIGRATION_DIR.glob("*.sql"), key=lambda p: p.name)
    exists: dict[str, bool] = {}
    violations: list[tuple[str, str]] = []
    checked_replacements = 0

    for path in migrations:
        sql = strip_comments(path.read_text(encoding="utf-8"))
        post_baseline = path.name >= BASELINE

        for match in TOKEN_RE.finditer(sql):
            if match.group("drop"):
                name = normalize(match.group("drop_name"))
                exists[name] = False
                continue

            name = normalize(match.group("create_name"))
            is_replace = bool(match.group("replace"))

            if post_baseline and is_replace and exists.get(name, False):
                violations.append((path.name, name))
            elif post_baseline and is_replace:
                checked_replacements += 1

            exists[name] = True

    if violations:
        print("FAIL: unsafe post-truth-floor CREATE OR REPLACE VIEW detected.")
        print("A view that already exists must be explicitly dropped earlier in migration order before replacement.")
        for filename, view_name in violations:
            print(f" - {filename}: {view_name}")
        print("Add a narrowly-scoped pre-migration with DROP VIEW IF EXISTS <view>; do not use CASCADE unless dependencies are explicitly audited.")
        return 1

    print(
        "PASS: migration view replacement safety gate "
        f"({checked_replacements} post-baseline replacement(s) observed after explicit drop/new creation)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
