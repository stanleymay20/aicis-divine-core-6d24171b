#!/usr/bin/env python3
"""Inventory environment/secret names referenced by AICIS without reading values."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOTS = [
    ROOT / "supabase" / "functions",
    ROOT / "src",
    ROOT / "scripts",
    ROOT / ".github" / "workflows",
    ROOT / "migration",
]
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next"}
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".yml", ".yaml", ".toml", ".sql", ".md"}

PATTERNS = [
    re.compile(r"Deno\.env\.get\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]\s*\)"),
    re.compile(r"process\.env\.([A-Z][A-Z0-9_]*)"),
    re.compile(r"import\.meta\.env\.([A-Z][A-Z0-9_]*)"),
    re.compile(r"\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}"),
    re.compile(r"\$\{\{\s*vars\.([A-Z][A-Z0-9_]*)\s*\}\}"),
]

PLATFORM_PROVIDED = {
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
}

MIGRATION_ONLY_PREFIXES = (
    "AICIS_SOURCE_",
    "AICIS_TARGET_",
    "AICIS_BACKUP_",
)

FORBIDDEN_OR_OBSOLETE = {
    "LOVABLE_API_KEY",
}


def classify(name: str) -> str:
    if name in FORBIDDEN_OR_OBSOLETE:
        return "forbidden_or_obsolete"
    if name in PLATFORM_PROVIDED:
        return "supabase_platform_provided"
    if name.startswith("VITE_"):
        return "frontend_public_configuration"
    if name.startswith(MIGRATION_ONLY_PREFIXES):
        return "migration_only"
    if name in {"CI", "GITHUB_ACTIONS", "GITHUB_TOKEN"}:
        return "ci_platform_provided"
    return "custom_secret_or_configuration"


def iter_files():
    for scan_root in SCAN_ROOTS:
        if not scan_root.exists():
            continue
        if scan_root.is_file():
            yield scan_root
            continue
        for path in scan_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            yield path


def main() -> int:
    references: dict[str, set[str]] = {}

    for path in iter_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        rel = path.relative_to(ROOT).as_posix()
        for pattern in PATTERNS:
            for match in pattern.finditer(text):
                name = match.group(1)
                references.setdefault(name, set()).add(rel)

    entries = [
        {
            "name": name,
            "category": classify(name),
            "references": sorted(paths),
        }
        for name, paths in sorted(references.items())
    ]

    print("AICIS secret/configuration name inventory (values are never read)")
    print(f"names={len(entries)}")
    for entry in entries:
        print(f"{entry['category']}\t{entry['name']}\trefs={len(entry['references'])}")

    forbidden = [entry["name"] for entry in entries if entry["category"] == "forbidden_or_obsolete"]
    if forbidden:
        print("FORBIDDEN_OR_OBSOLETE_REFERENCES=" + ",".join(forbidden))

    output = ROOT / "artifacts" / "aicis-secret-name-inventory.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"entries": entries}, indent=2) + "\n", encoding="utf-8")
    print(f"inventory_json={output.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
