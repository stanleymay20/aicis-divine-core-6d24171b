#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"

required_files = [
    MIGRATIONS / "20260827083000_learning_loop_truth_floor_v1.sql",
    MIGRATIONS / "20260829090000_prediction_truth_floor_v2.sql",
]

errors: list[str] = []
for path in required_files:
    if not path.exists():
        errors.append(f"missing required migration: {path.relative_to(ROOT)}")

if errors:
    for error in errors:
        print(f"ERROR: {error}")
    sys.exit(1)

v1 = required_files[0].read_text(encoding="utf-8")
v2 = required_files[1].read_text(encoding="utf-8")
combined = v1 + "\n" + v2

required_patterns = {
    "risk horizon target": r"target_horizon_date",
    "bounded risk outcome": r"s\.snapshot_date\s*>=\s*d\.target_horizon_date",
    "risk abstention table": r"risk_prediction_resolution_attempts",
    "legacy risk exclusion": r"resolution_method\s*=\s*'performance_index_change_gt_1_pre_prediction_sd_v1'",
    "sealed prediction protection": r"protect_sealed_risk_prediction_truth",
    "prospective forecast truth table": r"forecast_truth_floor_realizations",
    "forecast horizon due time": r"realization_due_at",
    "bounded forecast outcome": r"s\.snapshot_date\s*>=\s*d\.realization_due_at::date",
    "forecast missing horizon abstention": r"missing_horizon_observation",
    "forecast baseline abstention": r"insufficient_baseline_history",
    "forecast variance abstention": r"unmeasurable_baseline_variance",
    "discontinuity quarantine": r"suspicious_discontinuity",
    "external evidence ledger": r"prediction_external_outcomes",
    "external verification status": r"verification_status",
    "claim strength surface": r"claim_strength",
    "internal outcome semantics": r"derived_country_performance_index",
    "service-role-only forecast realization": r"GRANT EXECUTE ON FUNCTION public\.realize_forecast_truth_floor.*TO service_role",
}

for label, pattern in required_patterns.items():
    if not re.search(pattern, combined, re.IGNORECASE | re.DOTALL):
        errors.append(f"missing truth-floor requirement: {label}")

# The v2 evaluator must select the first observation in the bounded target window,
# not the newest available observation at evaluation time.
if not re.search(
    r"s\.snapshot_date\s*>=\s*d\.realization_due_at::date.*?"
    r"s\.snapshot_date\s*<=\s*d\.realization_due_at::date\s*\+\s*p_max_outcome_lag_days.*?"
    r"ORDER BY s\.snapshot_date ASC.*?LIMIT 1",
    v2,
    re.IGNORECASE | re.DOTALL,
):
    errors.append("forecast outcome selection is not provably first-observation-in-bounded-target-window")

# Claim views must never equate a rigorous internal derived metric with an
# externally verified event merely because the internal label resolved.
if "externally_verified_real_world_outcome" not in v2:
    errors.append("evidence views do not expose external verification separately")
if "internal_derived_metric_only" not in v2:
    errors.append("evidence views do not label internal-only outcomes")

# View-shape safety: shape-changing views must be dropped before creation.
for view_name in (
    "risk_prediction_evidence_report_v1",
    "forecast_prediction_evidence_report_v1",
):
    drop = f"DROP VIEW IF EXISTS public.{view_name};"
    create = f"CREATE VIEW public.{view_name} AS"
    if drop not in v2 or create not in v2 or v2.index(drop) > v2.index(create):
        errors.append(f"view replacement safety missing for {view_name}")

# The new evaluator may use now() only to determine which predictions are due
# and to timestamp the evaluation. It must not compare outcome snapshots to
# current date/time as a replacement for the declared horizon.
forbidden_patterns = {
    "latest snapshot fallback": r"ORDER BY\s+s\.snapshot_date\s+DESC\s+LIMIT\s+1\s*\)\s*os\s+ON\s+true",
    "outcome bounded by today": r"s\.snapshot_date\s*<=\s*(?:v_now|CURRENT_DATE|now\(\))",
}
for label, pattern in forbidden_patterns.items():
    if re.search(pattern, v2, re.IGNORECASE | re.DOTALL):
        errors.append(f"forbidden truth-floor pattern found: {label}")

if errors:
    print("Prediction truth-floor audit FAILED")
    for error in errors:
        print(f" - {error}")
    sys.exit(1)

print("Prediction truth-floor audit passed")
print(" - risk realizations use bounded target-horizon observations")
print(" - missing evidence remains abstention/unknown")
print(" - sealed prospective truth fields are protected")
print(" - deterministic forecasts have an independent bounded-horizon evaluator")
print(" - suspicious boundary discontinuities are quarantined")
print(" - internal derived outcomes are separated from externally verified events")
