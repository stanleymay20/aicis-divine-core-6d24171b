#!/usr/bin/env python3
"""Fail CI on canonical Edge Function portability defects.

Checks:
1. Every relative static import in supabase/functions/**/*.ts resolves to a file.
2. Trusted-worker auth helpers are consumed through their documented `response`
   contract rather than a nonexistent `.ok` property.

This is intentionally static and conservative. Remote http(s) imports are ignored.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = ROOT / "supabase" / "functions"

IMPORT_RE = re.compile(
    r"(?:from\s+|import\s*\()(?P<quote>['\"])(?P<path>\.{1,2}/[^'\"]+)(?P=quote)"
)
AUTH_ASSIGN_RE = re.compile(
    r"\b(?:const|let)\s+(?P<var>[A-Za-z_$][\w$]*)\s*=\s*await\s+"
    r"(?P<helper>require(?:Admin|User)OrTrustedWorker)\s*\("
)


def resolve_import(source: Path, raw: str) -> Path | None:
    candidate = (source.parent / raw).resolve()
    if candidate.is_file():
        return candidate
    if candidate.suffix == "":
        for suffix in (".ts", ".tsx", ".js", ".mjs"):
            expanded = candidate.with_suffix(suffix)
            if expanded.is_file():
                return expanded
        for name in ("index.ts", "index.tsx", "index.js"):
            expanded = candidate / name
            if expanded.is_file():
                return expanded
    return None


def relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main() -> int:
    if not FUNCTIONS.is_dir():
        print("ERROR: supabase/functions directory missing")
        return 1

    blockers: list[str] = []
    scanned = 0
    local_imports = 0
    auth_contracts = 0

    for source in sorted(FUNCTIONS.rglob("*.ts")):
        scanned += 1
        text = source.read_text(encoding="utf-8")

        for match in IMPORT_RE.finditer(text):
            raw = match.group("path")
            local_imports += 1
            if resolve_import(source, raw) is None:
                line = text.count("\n", 0, match.start()) + 1
                blockers.append(
                    f"{relative(source)}:{line}: unresolved relative import {raw!r}"
                )

        for match in AUTH_ASSIGN_RE.finditer(text):
            auth_contracts += 1
            var = re.escape(match.group("var"))
            bad_ok = re.compile(rf"\b{var}\.ok\b")
            bad_match = bad_ok.search(text, match.end())
            if bad_match:
                line = text.count("\n", 0, bad_match.start()) + 1
                blockers.append(
                    f"{relative(source)}:{line}: trusted-worker auth result uses .ok; "
                    "check .response instead"
                )

    print(f"edge_function_ts_files={scanned}")
    print(f"relative_imports_checked={local_imports}")
    print(f"trusted_worker_auth_contracts_checked={auth_contracts}")
    print(f"portability_blockers={len(blockers)}")

    for blocker in blockers:
        print(f"BLOCKER: {blocker}")

    if blockers:
        return 1
    print("Edge Function portability audit passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
