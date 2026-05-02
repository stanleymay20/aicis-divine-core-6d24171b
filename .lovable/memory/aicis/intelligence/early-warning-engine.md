---
name: Early Warning Engine (LRIL v16)
description: Detects rising clusters, repeated locality incidents, severity spikes, cross-border spillover, and weak signals from LRIL events. Tables aicis_early_warnings/aicis_warning_evidence/aicis_warning_snapshots. compute_early_warnings() runs every 30min.
type: feature
---
LRIL v16 builds on the v15 local event corpus to surface 5 warning kinds:

1. **rising_cluster** — ≥3 events same iso3+subtype in last 24h, +50% vs prior 24h.
2. **repeated_locality** — ≥3 events same iso3+locality+subtype within 7d.
3. **severity_spike** — 24h avg severity ≥1.5× prior 7d baseline + 0.1.
4. **cross_border_spillover** — same subtype across two countries within 2000km centroid distance, last 48h.
5. **weak_signal** — ≥2 low-confidence (0.2–0.4) events same locality+subtype in last 6h with ≥2 sources.

Each warning carries: iso3, locality, event_type, subtype, severity, confidence, escalation_probability (capped 0.95), time_window_hours, source_count, event_count, evidence (JSONB), recommended_next_action.

Cron: `compute-early-warnings-30min` every 30min. Snapshots written to `aicis_warning_snapshots` for trend tracking.

Initial run: 206 warnings (200 spillover, 4 repeated_locality, 1 severity_spike, 1 rising_cluster).
