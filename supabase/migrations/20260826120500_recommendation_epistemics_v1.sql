-- AICIS Recommendation Epistemics v1
-- Recommendations are decision-support candidates, not observed outcomes.
-- Financial impact and recommendation confidence remain unknown unless backed
-- by explicit evidence. Historical template-derived numbers are preserved for
-- audit but marked legacy_unverified.

ALTER TABLE public.risk_action_recommendations
  ALTER COLUMN estimated_roi_eur DROP DEFAULT,
  ALTER COLUMN estimated_cost_eur DROP DEFAULT,
  ALTER COLUMN confidence DROP DEFAULT;

ALTER TABLE public.risk_action_recommendations
  ADD COLUMN IF NOT EXISTS economics_status text NOT NULL DEFAULT 'not_estimated'
    CHECK (economics_status IN ('not_estimated','legacy_unverified','evidence_backed')),
  ADD COLUMN IF NOT EXISTS economics_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommendation_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_status_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_status_changed_at timestamptz;

UPDATE public.risk_action_recommendations
SET economics_status = 'legacy_unverified',
    recommendation_basis = COALESCE(recommendation_basis, '{}'::jsonb) || jsonb_build_object(
      'legacy_template_economics', true,
      'epistemic_note', 'Historical ROI/cost/confidence values were template-derived and are not evidence-backed estimates.'
    )
WHERE economics_status = 'not_estimated'
  AND (
    estimated_roi_eur IS NOT NULL
    OR estimated_cost_eur IS NOT NULL
    OR confidence IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_risk_actions_economics_status
  ON public.risk_action_recommendations(economics_status, generated_at DESC);

DROP POLICY IF EXISTS "Authenticated users can update recommendation status"
  ON public.risk_action_recommendations;
REVOKE UPDATE ON public.risk_action_recommendations FROM authenticated;

-- Replacement generator: preserves the domain action catalogue as an explicit
-- heuristic, but never manufactures cost, ROI, recommendation confidence, or
-- intervention effect. Those fields remain NULL until a separate evidence-
-- backed economics workflow supplies them.
CREATE OR REPLACE FUNCTION public.generate_risk_action_recommendations(p_top_n integer DEFAULT 50)
RETURNS TABLE(batch_id uuid, generated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_source_batch uuid;
  v_count integer := 0;
BEGIN
  SELECT generation_batch_id
  INTO v_source_batch
  FROM public.risk_ranking_predictions
  ORDER BY generated_at DESC
  LIMIT 1;

  IF v_source_batch IS NULL THEN
    RETURN QUERY SELECT v_batch_id, 0;
    RETURN;
  END IF;

  WITH top AS (
    SELECT *
    FROM public.risk_ranking_predictions
    WHERE generation_batch_id = v_source_batch
    ORDER BY rank_position ASC NULLS LAST, risk_probability DESC
    LIMIT GREATEST(1, LEAST(p_top_n, 200))
  ),
  classified AS (
    SELECT
      t.*,
      CASE t.domain
        WHEN 'health'     THEN 'health_stockpile_prepositioning'
        WHEN 'energy'     THEN 'fuel_reserve_activation'
        WHEN 'food'       THEN 'import_buffer_release'
        WHEN 'finance'    THEN 'fx_liquidity_facility'
        WHEN 'governance' THEN 'institutional_dialogue_track'
        WHEN 'security'   THEN 'preventive_monitoring'
        WHEN 'climate'    THEN 'early_warning_activation'
        WHEN 'education'  THEN 'continuity_program'
        WHEN 'population' THEN 'demographic_surge_planning'
        ELSE 'monitoring_escalation'
      END AS intervention_type,
      CASE t.domain
        WHEN 'health'     THEN 'Review emergency health stockpile readiness · ' || t.country_iso3
        WHEN 'energy'     THEN 'Review strategic fuel-reserve readiness · ' || t.country_iso3
        WHEN 'food'       THEN 'Review import-buffer and logistics options · ' || t.country_iso3
        WHEN 'finance'    THEN 'Review FX liquidity contingency options · ' || t.country_iso3
        WHEN 'governance' THEN 'Review institutional dialogue options · ' || t.country_iso3
        WHEN 'security'   THEN 'Review preventive monitoring posture · ' || t.country_iso3
        WHEN 'climate'    THEN 'Review early-warning and evacuation readiness · ' || t.country_iso3
        WHEN 'education'  THEN 'Review education continuity options · ' || t.country_iso3
        WHEN 'population' THEN 'Review demographic-surge planning · ' || t.country_iso3
        ELSE 'Escalate monitoring review · ' || t.country_iso3
      END AS intervention_title,
      CASE
        WHEN t.risk_probability >= 0.7 THEN '24h'
        WHEN t.risk_probability >= 0.5 THEN '72h'
        WHEN t.risk_probability >= 0.3 THEN '7d'
        ELSE '30d'
      END AS urgency_window,
      CASE
        WHEN t.risk_probability >= 0.7 THEN 24
        WHEN t.risk_probability >= 0.5 THEN 72
        WHEN t.risk_probability >= 0.3 THEN 168
        ELSE 720
      END AS urgency_hours
    FROM top t
  )
  INSERT INTO public.risk_action_recommendations (
    ranking_id,
    country_iso3,
    domain,
    risk_probability,
    rank_position,
    intervention_type,
    intervention_title,
    rationale_md,
    responsible_domain,
    urgency_window,
    urgency_hours,
    estimated_roi_eur,
    estimated_cost_eur,
    confidence,
    status,
    batch_id,
    economics_status,
    economics_evidence,
    recommendation_basis
  )
  SELECT
    c.id,
    c.country_iso3,
    c.domain,
    c.risk_probability,
    c.rank_position,
    c.intervention_type,
    c.intervention_title,
    format(
      E'**Decision-support candidate**\n- Source: latest %s risk-ranking model\n- Model deterioration estimate: %s%%\n- Domain: %s\n- Review window: %s\n\n**Evidence boundary**\nThis action is selected from a domain action catalogue. It is not proof that the intervention will work, and AICIS has not estimated its financial cost, ROI, or causal effect. Human review and intervention-specific evidence are required before execution.',
      c.model_version,
      ROUND(c.risk_probability * 100)::text,
      c.domain,
      c.urgency_window
    ),
    c.domain,
    c.urgency_window,
    c.urgency_hours,
    NULL,
    NULL,
    NULL,
    'proposed',
    v_batch_id,
    'not_estimated',
    '[]'::jsonb,
    jsonb_build_object(
      'method', 'domain_action_catalog_v2',
      'source_ranking_id', c.id,
      'source_generation_batch_id', c.generation_batch_id,
      'source_model_version', c.model_version,
      'risk_probability', c.risk_probability,
      'risk_probability_semantics', 'model estimate, not observed fact',
      'source_factors', c.factors,
      'urgency_method', 'risk_probability_review_window_heuristic_v1',
      'economics_status', 'not_estimated',
      'human_review_required', true
    )
  FROM classified c;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch_id, v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_risk_action_recommendations(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_risk_action_recommendations(integer)
  TO service_role;

COMMENT ON FUNCTION public.generate_risk_action_recommendations(integer) IS
  'Generates review candidates from risk rankings without fabricated ROI, cost, confidence, or intervention-effect estimates.';
