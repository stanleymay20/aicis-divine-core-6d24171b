
-- ============================================================
-- Pilot Execution Wave
-- ============================================================

-- 1. Unified pilot execution queue
CREATE OR REPLACE VIEW public.pilot_execution_queue
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    r.id,
    r.country_iso3,
    r.domain,
    r.intervention_type,
    r.intervention_title,
    r.rationale_md,
    r.confidence,
    r.estimated_roi_eur,
    r.estimated_cost_eur,
    r.urgency_window,
    r.urgency_hours,
    r.status,
    r.rank_position,
    r.created_at,
    r.accepted_at,
    r.executed_at,
    r.outcome_logged_at,
    r.linked_outcome_id,
    COALESCE(a.adjustment_multiplier, 1.0) AS learning_multiplier,
    a.quality_score AS intervention_quality_score,
    a.rationale     AS adjustment_rationale,
    -- urgency factor: 1.0 for 24h, 0.85 for 72h, 0.7 for 7d, 0.55 for 30d+
    CASE
      WHEN r.urgency_hours <= 24  THEN 1.00
      WHEN r.urgency_hours <= 72  THEN 0.85
      WHEN r.urgency_hours <= 168 THEN 0.70
      ELSE 0.55
    END AS urgency_factor,
    -- ROI factor: log-scaled, capped at 1.0 (€100k+ saturates)
    LEAST(GREATEST(LN(GREATEST(r.estimated_roi_eur, 1)) / LN(100000), 0)::numeric, 1.0) AS roi_factor
  FROM public.risk_action_recommendations r
  LEFT JOIN public.risk_action_score_adjustments a USING (intervention_type)
  WHERE r.status IN ('proposed', 'accepted', 'executed')
)
SELECT
  id,
  country_iso3,
  domain,
  intervention_type,
  intervention_title,
  rationale_md,
  confidence,
  estimated_roi_eur,
  estimated_cost_eur,
  urgency_window,
  urgency_hours,
  status,
  rank_position,
  created_at,
  accepted_at,
  executed_at,
  outcome_logged_at,
  linked_outcome_id,
  learning_multiplier,
  intervention_quality_score,
  adjustment_rationale,
  urgency_factor,
  roi_factor,
  ROUND((confidence * learning_multiplier)::numeric, 4) AS adjusted_priority_score,
  -- composite pilot priority: 50% adjusted confidence + 30% ROI + 20% urgency
  ROUND((
    0.50 * (confidence * learning_multiplier)
  + 0.30 * roi_factor
  + 0.20 * urgency_factor
  )::numeric, 4) AS pilot_priority_score,
  CASE
    WHEN status = 'proposed' THEN 'rank_for_execution'
    WHEN status = 'accepted' THEN 'awaiting_execution'
    WHEN status = 'executed' THEN 'awaiting_outcome'
  END AS queue_stage,
  -- 7-day outcome reminder
  CASE
    WHEN status = 'executed'
         AND outcome_logged_at IS NULL
         AND executed_at IS NOT NULL
         AND executed_at < (now() - interval '7 days') THEN true
    WHEN status = 'accepted'
         AND outcome_logged_at IS NULL
         AND accepted_at IS NOT NULL
         AND accepted_at < (now() - interval '7 days') THEN true
    ELSE false
  END AS outcome_needed,
  -- age in days at the relevant stage anchor
  EXTRACT(EPOCH FROM (now() - COALESCE(executed_at, accepted_at, created_at))) / 86400.0 AS stage_age_days
FROM base;

COMMENT ON VIEW public.pilot_execution_queue IS
  'Pilot Execution Wave: unified ranked queue. pilot_priority_score = 0.5·(confidence×learning_multiplier) + 0.3·roi_factor + 0.2·urgency_factor. outcome_needed flips true after 7 days without outcome.';


-- 2. Weekly pilot metrics
CREATE OR REPLACE VIEW public.pilot_weekly_metrics
WITH (security_invoker = true) AS
SELECT
  COUNT(*) FILTER (WHERE accepted_at >= (now() - interval '7 days'))         AS accepted_this_week,
  COUNT(*) FILTER (WHERE executed_at >= (now() - interval '7 days'))         AS executed_this_week,
  COUNT(*) FILTER (WHERE outcome_logged_at >= (now() - interval '7 days'))   AS outcomes_logged_this_week,
  COUNT(*) FILTER (
    WHERE outcome_logged_at IS NULL
      AND (
        (status = 'executed' AND executed_at < (now() - interval '7 days'))
        OR (status = 'accepted' AND accepted_at < (now() - interval '7 days'))
      )
  ) AS outcome_needed_count,
  COUNT(*) FILTER (WHERE status = 'proposed') AS proposed_open_count,
  COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_open_count,
  COUNT(*) FILTER (WHERE status = 'executed') AS executed_open_count
FROM public.risk_action_recommendations;

COMMENT ON VIEW public.pilot_weekly_metrics IS
  'Pilot Execution Wave: rolling 7-day operator activity + open outcome-needed backlog.';
