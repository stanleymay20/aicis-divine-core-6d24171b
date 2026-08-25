#!/usr/bin/env python3
"""Fail when a verify_jwt=false Edge Function uses service role without caller validation."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "supabase" / "config.toml"
FUNCTIONS = ROOT / "supabase" / "functions"

AUTH_MARKERS = (
    "requireAdminOrCron(",
    "requireCronSecret(",
    "requireAdminUser(",
    "requireUser(",
    "requireTier(",
    ".auth.getUser(",
    "auth.getUser(",
)

WEBHOOK_OR_SIGNATURE_MARKERS = (
    "stripe-signature",
    "webhooks.constructEvent",
    "WEBHOOK_SECRET",
    "webhook_secret",
    "createHmac(",
    "crypto.subtle.verify",
    "x-signature",
    "x-webhook-signature",
    "verifySignature(",
    "verifyHmac(",
)


def parse_config(text: str) -> dict[str, bool]:
    result: dict[str, bool] = {}
    current: str | None = None
    section_re = re.compile(r"^\[functions\.([^\]]+)\]\s*$")
    jwt_re = re.compile(r"^verify_jwt\s*=\s*(true|false)\s*$", re.I)

    for raw_line in text.splitlines():
        line = raw_line.strip()
        section = section_re.match(line)
        if section:
            current = section.group(1)
            continue
        jwt = jwt_re.match(line)
        if current and jwt:
            result[current] = jwt.group(1).lower() == "true"
    return result


def has_caller_validation(source: str) -> bool:
    return any(marker in source for marker in AUTH_MARKERS + WEBHOOK_OR_SIGNATURE_MARKERS)


def main() -> int:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    false_jwt = sorted(name for name, verify in config.items() if not verify)
    high_risk: list[str] = []
    missing_source: list[str] = []
    custom_guarded: list[str] = []
    public_or_nonprivileged: list[str] = []

    for name in false_jwt:
        path = FUNCTIONS / name / "index.ts"
        if not path.exists():
            missing_source.append(name)
            continue
        source = path.read_text(encoding="utf-8")
        uses_service_role = "SUPABASE_SERVICE_ROLE_KEY" in source
        guarded = has_caller_validation(source)

        if uses_service_role and not guarded:
            high_risk.append(name)
        elif uses_service_role and guarded:
            custom_guarded.append(name)
        else:
            public_or_nonprivileged.append(name)

    print("AICIS Edge Function auth audit")
    print(f"verify_jwt_false={len(false_jwt)}")
    print(f"privileged_custom_guarded={len(custom_guarded)}")
    print(f"public_or_nonprivileged_review={len(public_or_nonprivileged)}")
    print(f"missing_source={len(missing_source)}")
    print(f"high_risk_privileged_unguarded={len(high_risk)}")

    if custom_guarded:
        print("guarded=" + ",".join(custom_guarded))
    if public_or_nonprivileged:
        print("public_or_nonprivileged=" + ",".join(public_or_nonprivileged))
    if missing_source:
        print("missing_source=" + ",".join(missing_source))
    if high_risk:
        print("HIGH_RISK=" + ",".join(high_risk))
        print("FAIL: verify_jwt=false service-role functions require explicit caller validation.")
        return 1

    print("PASS: no verify_jwt=false service-role function is missing caller validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
