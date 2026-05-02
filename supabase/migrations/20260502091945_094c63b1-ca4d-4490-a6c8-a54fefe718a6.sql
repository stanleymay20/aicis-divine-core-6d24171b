
DROP FUNCTION IF EXISTS public.refresh_recommendation_quality_scores();

CREATE OR REPLACE FUNCTION public.refresh_recommendation_quality_scores()
RETURNS TABLE(out_intervention_type text, out_quality_score numeric, out_adjustment_multiplier numeric, out_sample_size integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_mult numeric;
BEGIN
  FOR v_row IN SELECT * FROM public.recommendation_quality_score LOOP
    v_mult := ROUND((0.6 + (v_row.quality_score * 0.8))::numeric, 4);

    INSERT INTO public.risk_action_score_adjustments AS t
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
