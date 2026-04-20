---
name: Enterprise SGI Schema Foundation
description: Phase 1 of the merged enterprise + government-grade upgrade. Adds rigor (feature_hash, leakage flags, walk-forward splits, lineage), audit (hash chains on ML inference, realizations, API requests), depth (Wilson intervals, Monte Carlo iterations, multi-hop propagation, cross-domain transfer matrix), and ops (15-min materialized view refresh, hourly risk_scores, 6h cross-domain, hourly zombie sweep). 9 new tables, 8 extended tables, 1 materialized view (security_invoker wrapper), 4 helper functions, 4 new pg_cron jobs.
type: feature
---

# Enterprise SGI Schema Foundation (Phase 1 of upgrade)

## New tables (all RLS-enabled, read-for-authenticated)
- `risk_scores` — normalized 0-100 surface, separate from probabilistic `risk_ml_predictions`
- `training_dataset_splits` — deterministic walk-forward train/val/test, leakage-safe
- `feature_lineage` — every training row → source metric/event IDs
- `model_calibration_bins` — isotonic mapping (predicted prob → empirical prob) per model+domain
- `ml_inference_audit` — SHA-256 chain over (feature_hash, model_version, weights_hash) per prediction
- `model_promotion_decisions` — challenger wins only when ECE↓ AND AUC↑ AND Brier↓ over ≥30 realizations, p<0.05
- `cross_domain_influence` — domain × domain transfer matrix per region, learned via CORR
- `api_request_audit` — per-request SHA-256 chain (org_id-scoped RLS)
- `simulation_iterations` — per-iteration Monte Carlo results (queryable distribution)

## Extended tables
- `training_dataset_aicis`: feature_hash, label_horizon_end_at, is_leakage_safe, feature_version, data_density_score
- `risk_ranking_predictions`: confidence_lower/upper (Wilson), evidence_count, proxy_share
- `risk_ml_predictions`: raw_score, calibrated_score, prediction_interval_lower/upper, feature_contributions, audit_hash
- `risk_propagation_score`: decay_factor (multi-hop)
- `simulation_runs`: n_iterations, p10/p50/p90, cascade_depth, seed, shock_input (multi-domain), result_distribution
- `risk_action_recommendations`: counterfactual_md, expected_roi_lower/upper, evidence_chain, requires_dual_approval, first/second_approver, lifecycle_audit_hash
- `model_performance_log`: ece, auc, bias_by_region, realization_count
- `risk_prediction_realizations`: prediction_hash, previous_realization_hash, chain_hash

## Helper functions (all `search_path = public`, SECURITY DEFINER)
- `wilson_interval(successes, total, z)` — confidence intervals
- `compute_risk_scores()` — Engine 2: normalized 0-100 from latest training rows (idempotent batch)
- `compute_cross_domain_influence()` — co-movement transfer matrix via CORR over 30d
- `refresh_risk_rankings_current()` — refresh materialized view
- `timeout_zombie_jobs()` — auto-fail jobs running >1h

## Materialized view
- `risk_rankings_current` (raw view, `REVOKE ALL` from anon/authenticated)
- `risk_rankings_current_v` — `security_invoker=true` wrapper (this is what UI/API queries)

## pg_cron jobs (added)
- `sgi-refresh-risk-rankings` — `*/15 * * * *`
- `sgi-compute-risk-scores` — `7 * * * *`
- `sgi-cross-domain-influence` — `13 */6 * * *`
- `sgi-zombie-job-sweep` — `23 * * * *`

## Still to ship (next turn)
- run-simulation rewrite (Monte Carlo + simulation_iterations population)
- run-ml-inference rewrite (raw + calibrated scores + audit hash chain into ml_inference_audit)
- public-api v1 (HMAC signing + api_request_audit chain + /v1/audit/verify endpoint)
- UI: /risk-ranking multi-horizon + Wilson bands, new /simulation with sliders, new /predictions, /learning-loop ECE/AUC, /decision-ops counterfactuals + dual approval, new /api-audit hash-chain explorer
