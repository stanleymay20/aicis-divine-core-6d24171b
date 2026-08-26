#!/usr/bin/env python3
"""Fail when any service-role Edge Function lacks explicit caller validation.

Supabase gateway JWT verification is not, by itself, authorization for a
privileged worker: legacy anon keys are JWTs and can satisfy gateway signature
verification. Therefore every Edge Function that can obtain
SUPABASE_SERVICE_ROLE_KEY must establish an explicit trust boundary in-function
(user/admin/tier auth, cron secret, API-key validation, webhook/signature
verification, etc.).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "supabase" / "config.toml"
FUNCTIONS = ROOT / "supabase" / "functions"

AUTH_MARKERS = (
    "requireAdminOrCron(",
    "requireAdminOrTrustedWorker(",
    "requireUserOrTrustedWorker(",
    "requireCronSecret(",
    "requireAdminUser(",
    "requireUser(",
    "requireTier(",
    ".auth.getUser(",
    "auth.getUser(",
    ".auth.getClaims(",
    "auth.getClaims(",
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


def has_hashed_api_key_validation(source: str) -> bool:
    """Recognize the repository's explicit external API-key trust boundary.

    This intentionally requires the whole pattern rather than accepting a mere
    x-api-key string: request-header extraction, SHA-256 hashing, lookup by the
    stored key hash in api_keys, and a revocation check must all be present.
    Rate limits/scopes/expiry are valuable policy controls but are not required
    to prove caller identity for this privileged-auth gate.
    """

    has_header = bool(
        re.search(r"req\.headers\.get\(\s*['\"]x-api-key['\"]\s*\)", source)
    )
    has_sha256 = "SHA-256" in source and bool(
        re.search(r"\bkeyHash\b|\bkey_hash\b", source)
    )
    has_key_table_lookup = bool(
        re.search(r"\.from\(\s*['\"]api_keys['\"]\s*\)", source)
        and re.search(r"\.eq\(\s*['\"]key_hash['\"]\s*,", source)
    )
    has_revocation_check = bool(
        re.search(r"\.eq\(\s*['\"]revoked['\"]\s*,\s*false\s*\)", source)
        or (
            "revoked_at" in source
            and re.search(r"revoked_at\s*[!<>=]", source)
        )
    )
    return has_header and has_sha256 and has_key_table_lookup and has_revocation_check


def has_caller_validation(source: str) -> bool:
    return (
        any(marker in source for marker in AUTH_MARKERS + WEBHOOK_OR_SIGNATURE_MARKERS)
        or has_hashed_api_key_validation(source)
    )


def main() -> int:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    function_paths = sorted(FUNCTIONS.glob("*/index.ts"))

    privileged_guarded: list[str] = []
    privileged_unguarded: list[str] = []
    nonprivileged_public_or_gateway: list[str] = []
    verify_jwt_false_privileged: list[str] = []
    verify_jwt_true_or_default_privileged: list[str] = []

    for path in function_paths:
        name = path.parent.name
        source = path.read_text(encoding="utf-8")
        uses_service_role = "SUPABASE_SERVICE_ROLE_KEY" in source
        guarded = has_caller_validation(source)
        verify_jwt = config.get(name, True)

        if uses_service_role:
            if verify_jwt:
                verify_jwt_true_or_default_privileged.append(name)
            else:
                verify_jwt_false_privileged.append(name)

            if guarded:
                privileged_guarded.append(name)
            else:
                privileged_unguarded.append(name)
        elif not verify_jwt:
            nonprivileged_public_or_gateway.append(name)

    configured_missing_source = sorted(
        name for name in config
        if not (FUNCTIONS / name / "index.ts").exists()
    )

    print("AICIS Edge Function privileged-auth audit")
    print(f"functions_scanned={len(function_paths)}")
    print(f"service_role_functions={len(privileged_guarded) + len(privileged_unguarded)}")
    print(f"privileged_guarded={len(privileged_guarded)}")
    print(f"privileged_unguarded={len(privileged_unguarded)}")
    print(f"service_role_verify_jwt_false={len(verify_jwt_false_privileged)}")
    print(f"service_role_verify_jwt_true_or_default={len(verify_jwt_true_or_default_privileged)}")
    print(f"verify_jwt_false_nonprivileged_review={len(nonprivileged_public_or_gateway)}")
    print(f"configured_missing_source={len(configured_missing_source)}")

    if privileged_guarded:
        print("guarded=" + ",".join(privileged_guarded))
    if nonprivileged_public_or_gateway:
        print("public_or_nonprivileged=" + ",".join(nonprivileged_public_or_gateway))
    if configured_missing_source:
        print("configured_missing_source=" + ",".join(configured_missing_source))

    if privileged_unguarded:
        print("HIGH_RISK_PRIVILEGED_UNGUARDED=" + ",".join(privileged_unguarded))
        print(
            "FAIL: service-role Edge Functions require explicit caller validation; "
            "gateway verify_jwt alone is not a privileged authorization boundary."
        )
        return 1

    print("PASS: every service-role Edge Function has an explicit caller trust boundary.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
