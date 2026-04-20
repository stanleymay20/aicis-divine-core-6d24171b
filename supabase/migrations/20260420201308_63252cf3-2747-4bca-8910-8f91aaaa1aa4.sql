-- ============================================================
-- DECISION LAYER: Risk Action Recommendations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.risk_action_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ranking_id uuid REFERENCES public.risk_ranking_predictions(id) ON DELETE CASCADE,
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  risk_probability numeric NOT NULL,
  rank_position integer,

  -- Action details
  intervention_type text NOT NULL,
  intervention_title text NOT NULL,
  rationale_md text,
  responsible_domain text NOT NULL,

  -- Decision economics
  urgency_window text NOT NULL,            -- '24h' | '72h' | '7d' | '30d'
  urgency_hours integer NOT NULL,
  estimated_roi_eur numeric DEFAULT 0,
  estimated_cost_eur numeric DEFAULT 0,
  confidence numeric DEFAULT 0.6,

  -- Lifecycle
  status text NOT NULL DEFAULT 'proposed', -- proposed | accepted | dismissed | executed
  accepted_by uuid,
  accepted_at timestamptz,
  executed_at timestamptz,
  outcome_notes_md text,

  batch_id uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rar_batch ON public.risk_action_recommendations(batch_id);
CREATE INDEX IF NOT EXISTS idx_rar_status ON public.risk_action_recommendations(status, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rar_country ON public.risk_action_recommendations(country_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_rar_rank ON public.risk_action_recommendations(rank_position);

ALTER TABLE public.risk_action_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view risk action recommendations"
  ON public.risk_action_recommendations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update recommendation status"
  ON public.risk_action_recommendations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role manages recommendations"
  ON public.risk_action_recommendations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_rar_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_rar_updated_at ON public.risk_action_recommendations;
CREATE TRIGGER trg_rar_updated_at BEFORE UPDATE ON public.risk_action_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_rar_updated_at();

-- ============================================================
-- GENERATOR FUNCTION
-- Walks the most-recent risk_ranking_predictions batch and
-- emits one tailored action per row.
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_risk_action_recommendations(p_top_n integer DEFAULT 50)
RETURNS TABLE(batch_id uuid, generated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_latest_ts timestamptz;
  v_count integer := 0;
BEGIN
  -- Find latest ranking batch
  SELECT MAX(generated_at) INTO v_latest_ts FROM public.risk_ranking_predictions;
  IF v_latest_ts IS NULL THEN
    RETURN QUERY SELECT v_batch_id, 0;
    RETURN;
  END IF;

  WITH top AS (
    SELECT *
    FROM public.risk_ranking_predictions
    WHERE generated_at = v_latest_ts
    ORDER BY rank_position ASC
    LIMIT p_top_n
  ),
  classified AS (
    SELECT
      t.id AS ranking_id,
      t.country_iso3,
      t.domain,
      t.risk_probability,
      t.rank_position,
      t.factors,
      -- intervention catalog by domain
      CASE t.domain
        WHEN 'health'     THEN 'health_stockpile_prepositioning'
        WHEN 'energy'     THEN 'fuel_reserve_activation'
        WHEN 'food'       THEN 'import_buffer_release'
        WHEN 'finance'    THEN 'fx_liquidity_facility'
        WHEN 'governance' THEN 'institutional_dialogue_track'
        WHEN 'security'   THEN 'preventive_deployment'
        WHEN 'climate'    THEN 'early_warning_activation'
        WHEN 'education'  THEN 'continuity_program'
        WHEN 'population' THEN 'demographic_surge_planning'
        ELSE 'monitoring_escalation'
      END AS intervention_type,
      CASE t.domain
        WHEN 'health'     THEN 'Pre-position emergency health stockpile in ' || t.country_iso3
        WHEN 'energy'     THEN 'Activate strategic fuel reserve · ' || t.country_iso3
        WHEN 'food'       THEN 'Release import buffer & coordinate logistics · ' || t.country_iso3
        WHEN 'finance'    THEN 'Open FX liquidity facility · ' || t.country_iso3
        WHEN 'governance' THEN 'Open institutional dialogue track · ' || t.country_iso3
        WHEN 'security'   THEN 'Deploy preventive monitoring posture · ' || t.country_iso3
        WHEN 'climate'    THEN 'Activate early warning & evacuation chain · ' || t.country_iso3
        WHEN 'education'  THEN 'Trigger education continuity program · ' || t.country_iso3
        WHEN 'population' THEN 'Plan demographic surge response · ' || t.country_iso3
        ELSE 'Escalate monitoring · ' || t.country_iso3
      END AS intervention_title,
      -- urgency tiers
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
      END AS urgency_hours,
      -- ROI baseline by domain (€)
      CASE t.domain
        WHEN 'health'     THEN 2500000
        WHEN 'energy'     THEN 4500000
        WHEN 'food'       THEN 1800000
        WHEN 'finance'    THEN 6000000
        WHEN 'governance' THEN 1200000
        WHEN 'security'   THEN 3500000
        WHEN 'climate'    THEN 2200000
        WHEN 'education'  THEN 800000
        WHEN 'population' THEN 950000
        ELSE 500000
      END AS roi_base,
      CASE t.domain
        WHEN 'health'     THEN 350000
        WHEN 'energy'     THEN 600000
        WHEN 'food'       THEN 250000
        WHEN 'finance'    THEN 400000
        WHEN 'governance' THEN 120000
        WHEN 'security'   THEN 500000
        WHEN 'climate'    THEN 300000
        WHEN 'education'  THEN 100000
        WHEN 'population' THEN 110000
        ELSE 75000
      END AS cost_base
    FROM top t
  )
  INSERT INTO public.risk_action_recommendations (
    ranking_id, country_iso3, domain, risk_probability, rank_position,
    intervention_type, intervention_title, responsible_domain,
    urgency_window, urgency_hours,
    estimated_roi_eur, estimated_cost_eur,
    confidence, rationale_md, batch_id
  )
  SELECT
    c.ranking_id, c.country_iso3, c.domain, c.risk_probability, c.rank_position,
    c.intervention_type, c.intervention_title, c.domain,
    c.urgency_window, c.urgency_hours,
    ROUND((c.roi_base * c.risk_probability * 1.2)::numeric, 0),
    c.cost_base,
    LEAST(0.95, 0.55 + c.risk_probability * 0.4),
    format(
      E'**Why act now**\n- Predicted deterioration probability: %s%%\n- Rank #%s in latest model batch\n- Domain: %s\n- Window: %s\n\n**Expected impact**\n- Cost-of-inaction averted: €%s\n- Intervention cost: €%s\n- Net benefit (gross): €%s',
      ROUND(c.risk_probability * 100)::text,
      c.rank_position::text,
      c.domain,
      c.urgency_window,
      to_char(ROUND((c.roi_base * c.risk_probability * 1.2)::numeric, 0), 'FM999G999G999'),
      to_char(c.cost_base, 'FM999G999G999'),
      to_char(ROUND((c.roi_base * c.risk_probability * 1.2 - c.cost_base)::numeric, 0), 'FM999G999G999')
    ),
    v_batch_id
  FROM classified c;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_batch_id, v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_risk_action_recommendations(integer) TO authenticated, service_role;