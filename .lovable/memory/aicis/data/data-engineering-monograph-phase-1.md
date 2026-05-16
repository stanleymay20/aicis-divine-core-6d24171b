---
name: Data Engineering Monograph Implementation
description: Phase 1 of Springer Data Engineering (Chan/Talburt/Talley 2010) adoption. Adds source_iq_scorecards (TIQM 6 dims: completeness, accuracy, consistency, timeliness, validity, uniqueness) computed via compute_source_iq_scorecard()/refresh_all_source_iq() over normalized_metrics. Adds entity_identity_history (OYSTER append-only audit, hash-chained), er_rule_definitions (declarative ER rules seeded for country/org/locality), entity_match_blocks (q-gram/soundex/prefix/geohash blocking index), task_tokens + claim_task_token/complete_task_token (idempotent cron dedup). UI: SourceIQScorecardPanel on /governance indicators tab, ParallelCoordinatesChart on /analyst.
type: feature
---
Foundation tables for entity resolution, IQ governance, and idempotency derived from the ALAR/Acxiom monograph. Designed for G7-grade defensibility and 100M+ entity scale.
