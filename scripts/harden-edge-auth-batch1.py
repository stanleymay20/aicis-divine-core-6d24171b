#!/usr/bin/env python3
"""Apply AICIS privileged Edge Function caller-boundary hardening batch 1.

This transform intentionally leaves the 10 SQL-scheduled functions that still
need CRON_SECRET scheduler rebinding for batch 2.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
AUTH_PATH = ROOT / "supabase/functions/_shared/auth.ts"
AUDIT_PATH = ROOT / "scripts/audit-edge-function-auth.py"

USER_OR_WORKER = {
    "decision-infer",
    "entity-resolve",
    "generate-signal-recommendations",
    "prospective-lifecycle-test",
    "run-ml-inference",
    "run-simulation",
    "score-relevance",
}

ADMIN_OR_WORKER = {
    "alert-coherence-engine", "auto-escalate-decisions", "auto-learn-cycle",
    "batch-seed-regions", "bootstrap-training-data", "build-training-dataset",
    "calculate-vulnerability", "calibrate-decision-weights", "compute-graph-propagation",
    "coverage-equity-enforcer", "decision-recommend", "detect-global-anomalies",
    "detection-audit", "deterministic-execution-loop", "enrich-global-signals",
    "evaluate-decision-models", "evaluate-impact", "evidence-enforcement-scan",
    "fed-fanout-down", "fed-make-bundle", "fed-merge-global-prior",
    "fed-rollup-tiers", "fed-send-bundles", "gdelt-ingest", "geo-ner-events",
    "governance-alerts", "hierarchical-link-builder", "ingest-global-signals",
    "ingest-microdata", "ingest-resilient-events", "language-router",
    "learn-from-outcomes", "learn-policy-weights", "lril-country-sweep",
    "lril-ingest", "lril-proxy", "orchestrate-multi-agent",
    "phase-c-firecrawl-source-ingestion", "phase-c-official-source-ingestion",
    "phase-c-tiered-source-ingestion", "populate-global-profiles",
    "realize-due-prospective-forecasts", "reconcile-forecasts",
    "run-performance-engine-v2", "seed-community-metrics", "seed-retry-zero-result",
    "signal-canonicalizer", "signal-country-extractor", "signal-geocoder",
    "signal-hygiene", "signal-translator", "subnational-hybrid-inference",
    "trigger-daily-inference", "validate-data-truth", "validate-forecast-accuracy",
    "village-inference-engine", "watchlist-scan", "web-search-sweep",
    "weekly-decision-learning",
}

HELD_FOR_CRON_REBIND = {
    "autonomous-accumulator", "drive-performance-engine-v2", "gdelt-firehose",
    "graph-recovery-tick", "ingest-maritime-ais-telemetry",
    "ingest-opensky-aviation-telemetry", "lril-process", "narrative-clustering",
    "planetary-backfill", "reliefweb-firehose",
}

if len(USER_OR_WORKER) != 7 or len(ADMIN_OR_WORKER) != 59 or len(HELD_FOR_CRON_REBIND) != 10:
    raise SystemExit(
        f"unexpected set sizes: user={len(USER_OR_WORKER)} "
        f"admin={len(ADMIN_OR_WORKER)} held={len(HELD_FOR_CRON_REBIND)}"
    )
if (USER_OR_WORKER | ADMIN_OR_WORKER) & HELD_FOR_CRON_REBIND:
    raise SystemExit("hardening and hold sets overlap")


def install_shared_helpers() -> None:
    auth = AUTH_PATH.read_text()
    if "requireAdminOrTrustedWorker(" in auth:
        return

    anchor = "export async function enforceRateLimit(options: {"
    if anchor not in auth:
        raise SystemExit("auth helper insertion anchor not found")

    helper = """/**
 * Global privileged workers accept only an authenticated administrator, the
 * independently configured CRON_SECRET, or an exact service-role Bearer token.
 * The service-role path preserves trusted Edge-to-Edge SDK calls without
 * treating an anon JWT as authorization.
 */
function hasServiceRoleBearer(req: Request): boolean {
  const expected = Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\");
  const provided = bearerToken(req);
  return Boolean(expected && provided && provided === expected);
}

export async function requireAdminOrTrustedWorker(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<{
  user: unknown | null;
  via: \"admin\" | \"cron\" | \"service_role\" | null;
  response: Response | null;
}> {
  if (req.method === \"OPTIONS\") return { user: null, via: null, response: null };

  const expectedCron = Deno.env.get(\"CRON_SECRET\");
  const providedCron = req.headers.get(\"x-cron-secret\");
  if (expectedCron && providedCron && providedCron === expectedCron) {
    return { user: null, via: \"cron\", response: null };
  }

  if (hasServiceRoleBearer(req)) {
    return { user: null, via: \"service_role\", response: null };
  }

  const { user, response } = await requireAdminUser(req, extraHeaders);
  if (response) return { user, via: null, response };
  return { user, via: \"admin\", response: null };
}

/**
 * User-facing analytical workers may be called by an authenticated user or by
 * the same trusted scheduler/service-role paths used for internal orchestration.
 */
export async function requireUserOrTrustedWorker(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<{
  ctx: UserAuthContext | null;
  via: \"user\" | \"cron\" | \"service_role\" | null;
  response: Response | null;
}> {
  if (req.method === \"OPTIONS\") return { ctx: null, via: null, response: null };

  const expectedCron = Deno.env.get(\"CRON_SECRET\");
  const providedCron = req.headers.get(\"x-cron-secret\");
  if (expectedCron && providedCron && providedCron === expectedCron) {
    return { ctx: null, via: \"cron\", response: null };
  }

  if (hasServiceRoleBearer(req)) {
    return { ctx: null, via: \"service_role\", response: null };
  }

  const { ctx, response } = await requireUser(req, extraHeaders);
  if (response) return { ctx: null, via: null, response };
  return { ctx, via: \"user\", response: null };
}

"""
    AUTH_PATH.write_text(auth.replace(anchor, helper + anchor, 1))


def update_audit_markers() -> None:
    audit = AUDIT_PATH.read_text()
    if '"requireAdminOrTrustedWorker("' in audit:
        return
    needle = '    "requireAdminOrCron(",\n'
    if needle not in audit:
        raise SystemExit("audit marker insertion anchor not found")
    audit = audit.replace(
        needle,
        needle + '    "requireAdminOrTrustedWorker(",\n    "requireUserOrTrustedWorker(",\n',
        1,
    )
    AUDIT_PATH.write_text(audit)


def add_import(text: str, guard: str) -> str:
    pre_serve = text.split("serve", 1)[0]
    if re.search(rf"\b{re.escape(guard)}\b", pre_serve):
        return text

    pattern = re.compile(
        r'import\s*\{([^}]*)\}\s*from\s*["\']\.\./_shared/auth\.ts["\'];',
        re.S,
    )
    match = pattern.search(text)
    if match:
        names = ", ".join(part.strip() for part in match.group(1).split(",") if part.strip())
        replacement = f'import {{ {names}, {guard} }} from "../_shared/auth.ts";'
        return text[: match.start()] + replacement + text[match.end() :]

    return f'import {{ {guard} }} from "../_shared/auth.ts";\n' + text


SERVE_PATTERN = re.compile(
    r"(?m)^(?P<indent>\s*)(?:Deno\.)?serve\(async \((?P<req>[A-Za-z_$][\w$]*)(?::[^)]*)?\) => \{"
)


def harden_function(name: str, guard: str) -> bool:
    path = ROOT / f"supabase/functions/{name}/index.ts"
    if not path.exists():
        raise SystemExit(f"missing target: {name}")

    text = path.read_text()
    if "SUPABASE_SERVICE_ROLE_KEY" not in text:
        raise SystemExit(f"target no longer privileged: {name}")
    if f"{guard}(" in text:
        return False

    text = add_import(text, guard)
    match = SERVE_PATTERN.search(text)
    if not match:
        raise SystemExit(f"could not find async serve entrypoint: {name}")

    req = match.group("req")
    cors_arg = ""
    if re.search(r"\bcorsHeaders\b", text):
        cors_arg = ", corsHeaders"
    elif re.search(r"\bCORS_HEADERS\b", text):
        cors_arg = ", CORS_HEADERS"

    injection = (
        f"\n  const callerAuth = await {guard}({req}{cors_arg});"
        "\n  if (callerAuth.response) return callerAuth.response;\n"
    )
    path.write_text(text[: match.end()] + injection + text[match.end() :])
    return True


install_shared_helpers()
update_audit_markers()

changed = []
for function_name in sorted(USER_OR_WORKER | ADMIN_OR_WORKER):
    guard_name = (
        "requireUserOrTrustedWorker"
        if function_name in USER_OR_WORKER
        else "requireAdminOrTrustedWorker"
    )
    if harden_function(function_name, guard_name):
        changed.append(function_name)

print(f"hardened={len(changed)}")
print("held_for_cron_rebind=" + ",".join(sorted(HELD_FOR_CRON_REBIND)))
