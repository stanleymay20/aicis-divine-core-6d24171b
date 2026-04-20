---
name: Enterprise SGI Engines (Phase 2)
description: Phase 2 of the merged enterprise + government-grade upgrade. Rewrote run-simulation as Monte Carlo (50-2000 iterations, mulberry32 PRNG, Box-Muller normals, p10/p50/p90 quantiles, 20-bin histogram, per-iteration table writes capped at 100). Rewrote run-ml-inference with raw + isotonic-calibrated scores, 95% bootstrap prediction intervals, SHA-256 audit chain (feature_hash → weights_hash → combined_hash, prev-linked) into ml_inference_audit. Falls back to country_performance_snapshots when training_dataset_aicis is sparse. Three new UI pages: /simulation (sliders + histogram), /predictions (multi-horizon 7d/30d/90d with CI bands and audit hash truncation), /api-audit (hash-chain explorer for ML + API request audits).
type: feature
---

# Enterprise SGI Engines (Phase 2 of upgrade)

## Edge functions rewritten

### run-simulation (Monte Carlo)
- **PRNG**: mulberry32 seeded from `seed` param (deterministic, reproducible)
- **Normal samples**: Box-Muller from uniform PRNG
- **Iterations**: 50–2000 (default 500, slider on UI)
- **Cascade**: 1–5 hops with random-walked decay factor (0.6 ± 0.15)
- **Per-iteration**: shock = magnitude * (1 + 0.2 * gauss); per-country sensitivity = 0.5 + 0.5 * volatility
- **Outputs**: p10/p50/p90 quantiles + 20-bin histogram + mean + max affected count
- **Storage**: full row in `simulation_runs`; first 100 iterations sampled into `simulation_iterations`

### run-ml-inference (calibrated + audited)
- **Model**: logistic-baseline-v1 (9-feature sigmoid, intercept -0.4)
- **Calibration**: isotonic via `model_calibration_bins` (per domain, falls back to wildcard `*`)
- **Prediction interval**: ±1.96 * sqrt(p*(1-p)/30) (n_eff=30 bootstrap proxy), clipped [0,1]
- **Audit chain**: SHA-256 over `prevHash | featureHash | model | weightsHash | raw | calibrated`, written to `ml_inference_audit`
- **Fallback**: when `training_dataset_aicis` has <50 rows for the horizon, derives features from `country_performance_snapshots` (negative momentum → z-score proxy)
- **Batch insert**: 500-row chunks for both predictions and audits

## New UI pages
- **/simulation**: parameter sliders (magnitude, iterations, cascade depth, direction, domain, optional ISO3) + recent-runs list with p10/p50/p90 badges + inline 20-bin histogram bars
- **/predictions**: tabs for 7d/30d/90d horizons; each row shows raw, calibrated, 95% CI [lo–hi], audit hash truncation
- **/api-audit**: dual-tab hash-chain explorer (ML inference + API request); each entry shows prev → combined hash with feature/weights hash truncations

## Verified end-to-end
- POST /run-simulation `{magnitude:0.2, n_iterations:200}` → returns p10=7.94 / p50=11.12 / p90=14.72 with clean bell-shaped histogram
- POST /run-ml-inference `{horizon:7}` → 1000 calibrated predictions written, model_version=logistic-baseline-v1, weights_hash committed

## Still pending
- HMAC-signed Public API v1 (`/v1/*`) writing to `api_request_audit`
- Multi-hop graph propagation rewrite (current `compute-graph-propagation` is single-hop)
- Wilson confidence bands wired into existing `/risk-ranking` UI (data column already exists in `risk_ranking_predictions.confidence_lower/upper`, page just needs to render)
