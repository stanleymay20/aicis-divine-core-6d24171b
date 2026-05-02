
-- ============================================================
-- Wave 1C: Action Learning Loop
-- ============================================================

-- 1. Performance summary view (country × domain × intervention_type)
CREATE OR REPLACE VIEW public.risk_action_performance_summary
WITH (security_invoker = true) AS
SELECT
  r.country_iso3,
  r.domain,
  r.intervention_type,
  COUNT(*) FILTER (WHERE r.accepted_at IS NOT NULL)              AS accepted_count,
  COUNT(*) FILTER (WHERE r.executed_at IS NOT NULL)              AS executed_count,
  COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL)        AS outcome_logged_count,
  COUNT(*) FILTER (WHERE r.status = 'dismissed')                 AS dismissed_count,
  COUNT(*) FILTER (WHERE r.status = 'expired')                   AS expired_count,
  COUNT(*)                                                       AS total_count,
  -- success rate: fraction of outcome_logged rows where the linked outcome succeeded
  CASE
    WHEN COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL AND o.outcome_success IS NOT NULL) = 0 THEN NULL
    ELSE ROUND(
      COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL AND o.outcome_success = true)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL AND o.outcome_success IS NOT NULL), 0)::numeric,
      4
    )
  END AS success_rate,
  ROUND(AVG(o.net_value) FILTER (WHERE r.outcome_logged_at IS NOT NULL AND o.net_value IS NOT NULL)::numeric, 2) AS avg_net_value,
  ROUND(
    AVG(
      CASE
        WHEN r.outcome_logged_at IS NOT NULL
         AND o.net_value IS NOT NULL
         AND r.estimated_roi_eur IS NOT NULL
         AND r.estimated_roi_eur > 0
        THEN o.net_value::numeric / r.estimated_roi_eur::numeric
      END
    )::numeric, 4
  ) AS avg_roi_realization_ratio,
  MAX(r.outcome_logged_at) AS last_outcome_at
FROM public.risk_action_recommendations r
LEFT JOIN public.decision_outcome_log o ON o.id = r.linked_outcome_id
GROUP BY r.country_iso3, r.domain, r.intervention_type;

COMMENT ON VIEW public.risk_action_performance_summary IS
  'Wave 1C: per (country,domain,intervention_type) action lifecycle aggregates. Success/ROI computed only from outcome_logged rows.';


-- 2. Recommendation quality score (per intervention_type, global)
CREATE OR REPLACE VIEW public.recommendation_quality_score
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    r.intervention_type,
    COUNT(*)                                                                          AS total_proposed,
    COUNT(*) FILTER (WHERE r.accepted_at IS NOT NULL)                                 AS accepted_n,
    COUNT(*) FILTER (WHERE r.executed_at IS NOT NULL)                                 AS executed_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL)                           AS outcome_n,
    COUNT(*) FILTER (WHERE r.status = 'dismissed')                                    AS dismissed_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL AND o.outcome_success = true) AS success_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL AND o.outcome_success IS NOT NULL) AS scored_n,
    AVG(
      CASE
        WHEN r.outcome_logged_at IS NOT NULL
         AND o.net_value IS NOT NULL
         AND r.estimated_roi_eur IS NOT NULL
         AND r.estimated_roi_eur > 0
        THEN LEAST(o.net_value::numeric / r.estimated_roi_eur::numeric, 3.0)
      END
    ) AS avg_roi_real
  FROM public.risk_action_recommendations r
  LEFT JOIN public.decision_outcome_log o ON o.id = r.linked_outcome_id
  GROUP BY r.intervention_type
)
SELECT
  intervention_type,
  total_proposed,
  accepted_n,
  executed_n,
  outcome_n,
  dismissed_n,
  success_n,
  scored_n,
  ROUND(avg_roi_real::numeric, 4) AS avg_roi_realization,
  -- component scores
  ROUND((CASE WHEN total_proposed > 0 THEN executed_n::numeric / total_proposed ELSE 0 END)::numeric, 4) AS execution_rate,
  ROUND((CASE WHEN scored_n > 0 THEN success_n::numeric / scored_n ELSE 0 END)::numeric, 4)              AS success_rate,
  ROUND((CASE WHEN total_proposed > 0 THEN dismissed_n::numeric / total_proposed ELSE 0 END)::numeric, 4) AS dismissal_rate,
  -- confidence factor: 0..1, saturates around 30 outcome-logged samples
  ROUND(LEAST(outcome_n::numeric / 30.0, 1.0)::numeric, 4) AS sample_confidence,
  -- composite quality score (0..1):
  --   40% execution_rate + 35% success_rate + 25% normalized ROI realization (cap 1.5x => 1.0)
  --   then weighted by sample_confidence (small samples pulled toward 0.5 neutral)
  ROUND((
    LEAST(outcome_n::numeric / 30.0, 1.0) *
      (
        0.40 * (CASE WHEN total_proposed > 0 THEN executed_n::numeric / total_proposed ELSE 0 END)
      + 0.35 * (CASE WHEN scored_n > 0 THEN success_n::numeric / scored_n ELSE 0 END)
      + 0.25 * LEAST(COALESCE(avg_roi_real, 0) / 1.5, 1.0)
      )
    + (1 - LEAST(outcome_n::numeric / 30.0, 1.0)) * 0.5
  )::numeric, 4) AS quality_score,
  -- transparent explanation
  format(
    'execution=%s%% (%s/%s) · success=%s%% (%s/%s) · ROI realized=%sx · confidence=%s%% (n=%s)',
    ROUND((CASE WHEN total_proposed > 0 THEN executed_n::numeric * 100 / total_proposed ELSE 0 END), 1),
    executed_n, total_proposed,
    ROUND((CASE WHEN scored_n > 0 THEN success_n::numeric * 100 / scored_n ELSE 0 END), 1),
    success_n, scored_n,
    COALESCE(ROUND(avg_roi_real::numeric, 2)::text, '—'),
    ROUND(LEAST(outcome_n::numeric / 30.0, 1.0) * 100, 0),
    outcome_n
  ) AS score_explanation
FROM base;

COMMENT ON VIEW public.recommendation_quality_score IS
  'Wave 1C: per intervention_type quality score (0..1). Composite of execution, outcome success, ROI realization, weighted by sample confidence. Fully explainable.';


-- 3. Score adjustments table (raw confidence preserved separately)
CREATE TABLE IF NOT EXISTS public.risk_action_score_adjustments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_type     text NOT NULL UNIQUE,
  quality_score         numeric NOT NULL,
  adjustment_multiplier numeric NOT NULL DEFAULT 1.0,
  sample_size           integer NOT NULL DEFAULT 0,
  rationale             text NOT NULL,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rasa_intervention ON public.risk_action_score_adjustments(intervention_type);

ALTER TABLE public.risk_action_score_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read adjustments" ON public.risk_action_score_adjustments;
CREATE POLICY "Authenticated can read adjustments"
  ON public.risk_action_score_adjustments
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin/operator can insert adjustments" ON public.risk_action_score_adjustments;
CREATE POLICY "Admin/operator can insert adjustments"
  ON public.risk_action_score_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

DROP POLICY IF EXISTS "Admin/operator can update adjustments" ON public.risk_action_score_adjustments;
CREATE POLICY "Admin/operator can update adjustments"
  ON public.risk_action_score_adjustments
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));


-- 4. Refresh function: recomputes adjustments transparently
CREATE OR REPLACE FUNCTION public.refresh_recommendation_quality_scores()
RETURNS TABLE(intervention_type text, quality_score numeric, adjustment_multiplier numeric, sample_size integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_mult numeric;
BEGIN
  FOR v_row IN SELECT * FROM public.recommendation_quality_score LOOP
    -- Map quality_score (0..1) to multiplier in [0.6 .. 1.4]
    -- Neutral 0.5 -> 1.0; strong 1.0 -> 1.4; weak 0.0 -> 0.6
    v_mult := ROUND((0.6 + (v_row.quality_score * 0.8))::numeric, 4);

    INSERT INTO public.risk_action_score_adjustments
      (intervention_type, quality_score, adjustment_multiplier, sample_size, rationale, computed_at, updated_at)
    VALUES
      (v_row.intervention_type, v_row.quality_score, v_mult, v_row.outcome_n, v_row.score_explanation, now(), now())
    ON CONFLICT (intervention_type) DO UPDATE
      SET quality_score         = EXCLUDED.quality_score,
          adjustment_multiplier = EXCLUDED.adjustment_multiplier,
          sample_size           = EXCLUDED.sample_size,
          rationale             = EXCLUDED.rationale,
          computed_at           = now(),
          updated_at            = now();
  END LOOP;

  RETURN QUERY
    SELECT a.intervention_type, a.quality_score, a.adjustment_multiplier, a.sample_size
    FROM public.risk_action_score_adjustments a
    ORDER BY a.quality_score DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_recommendation_quality_scores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_recommendation_quality_scores() TO authenticated;


-- 5. Learning leaderboard view (for /pilot-truth UI)
CREATE OR REPLACE VIEW public.risk_action_learning_leaderboard
WITH (security_invoker = true) AS
WITH by_country AS (
  SELECT
    country_iso3,
    SUM(outcome_logged_count) AS outcomes,
    AVG(success_rate)         AS avg_success,
    AVG(avg_roi_realization_ratio) AS avg_roi
  FROM public.risk_action_performance_summary
  WHERE outcome_logged_count > 0
  GROUP BY country_iso3
),
by_domain AS (
  SELECT
    domain,
    SUM(outcome_logged_count) AS outcomes,
    AVG(success_rate)         AS avg_success,
    AVG(avg_roi_realization_ratio) AS avg_roi
  FROM public.risk_action_performance_summary
  WHERE outcome_logged_count > 0
  GROUP BY domain
)
SELECT 'intervention'::text AS scope, intervention_type AS key, quality_score AS score,
       outcome_n AS sample_size, score_explanation AS detail
FROM public.recommendation_quality_score
UNION ALL
SELECT 'country'::text, country_iso3, ROUND(COALESCE(avg_roi, 0)::numeric, 4),
       outcomes::int, format('avg success %s%% · avg ROI realized %sx · n=%s',
         ROUND((COALESCE(avg_success, 0) * 100)::numeric, 1),
         COALESCE(ROUND(avg_roi::numeric, 2)::text, '—'),
         outcomes)
FROM by_country
UNION ALL
SELECT 'domain'::text, domain, ROUND(COALESCE(avg_roi, 0)::numeric, 4),
       outcomes::int, format('avg success %s%% · avg ROI realized %sx · n=%s',
         ROUND((COALESCE(avg_success, 0) * 100)::numeric, 1),
         COALESCE(ROUND(avg_roi::numeric, 2)::text, '—'),
         outcomes)
FROM by_domain;

COMMENT ON VIEW public.risk_action_learning_leaderboard IS
  'Wave 1C: unified leaderboard surfacing best/worst interventions, countries, and domains for the /pilot-truth learning section.';


-- 6. Adjusted recommendation view (raw confidence preserved; new adjusted score added)
CREATE OR REPLACE VIEW public.risk_action_recommendations_adjusted
WITH (security_invoker = true) AS
SELECT
  r.*,
  COALESCE(a.adjustment_multiplier, 1.0)                       AS learning_multiplier,
  ROUND((r.confidence * COALESCE(a.adjustment_multiplier, 1.0))::numeric, 4) AS adjusted_priority_score,
  a.quality_score                                              AS intervention_quality_score,
  a.rationale                                                  AS adjustment_rationale,
  a.sample_size                                                AS adjustment_sample_size
FROM public.risk_action_recommendations r
LEFT JOIN public.risk_action_score_adjustments a USING (intervention_type);

COMMENT ON VIEW public.risk_action_recommendations_adjusted IS
  'Wave 1C: raw recommendations with a transparent adjusted_priority_score = confidence × learning_multiplier. Raw confidence is never mutated; ranking adjustments are auditable.';
