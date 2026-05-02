-- Wave 1: Forecast realization auto-lock + action expiry + pilot truth feed

-- 1. Auto-lock realized forecasts
CREATE OR REPLACE FUNCTION public.tg_lock_realized_forecast()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.realized_at IS NOT NULL AND OLD.realized_at IS NULL THEN
    NEW.evaluation_locked := true;
  END IF;
  IF OLD.evaluation_locked = true AND (
    NEW.predicted_value IS DISTINCT FROM OLD.predicted_value OR
    NEW.predicted_direction IS DISTINCT FROM OLD.predicted_direction OR
    NEW.realized_value IS DISTINCT FROM OLD.realized_value OR
    NEW.realized_direction IS DISTINCT FROM OLD.realized_direction OR
    NEW.realized_at IS DISTINCT FROM OLD.realized_at
  ) THEN
    RAISE EXCEPTION 'forecast_prospective_evaluations row % is locked and immutable', OLD.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lock_realized_forecast ON public.forecast_prospective_evaluations;
CREATE TRIGGER trg_lock_realized_forecast
  BEFORE UPDATE ON public.forecast_prospective_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_realized_forecast();

-- 2. Action expiry sweep
CREATE OR REPLACE FUNCTION public.expire_stale_risk_actions()
RETURNS TABLE(expired_count int) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.risk_action_recommendations
    SET status='expired', updated_at=now(),
        outcome_notes_md = COALESCE(outcome_notes_md,'') || E'\n[auto-expired ' || now()::text || ' — urgency window elapsed]'
    WHERE status='proposed'
      AND created_at + (urgency_hours || ' hours')::interval < now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM upd;
  RETURN QUERY SELECT v_count;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='expire-stale-risk-actions') THEN
    PERFORM cron.unschedule('expire-stale-risk-actions');
  END IF;
END $$;
SELECT cron.schedule('expire-stale-risk-actions', '*/30 * * * *', $cron$SELECT public.expire_stale_risk_actions();$cron$);

-- 3. Pilot Truth Feed view
DROP VIEW IF EXISTS public.pilot_truth_feed;
CREATE VIEW public.pilot_truth_feed
WITH (security_invoker = true) AS
SELECT
  dol.id AS outcome_id,
  COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at) AS outcome_recorded_at,
  dol.iso3,
  dol.domain,
  dol.signal_title,
  dol.recommended_action,
  dol.action_taken,
  dol.outcome_success,
  dol.measured_impact_score,
  dol.roi_estimate,
  dol.net_value,
  dol.review_status,
  rar.id AS action_id,
  rar.intervention_type,
  rar.intervention_title,
  rar.estimated_roi_eur,
  rar.urgency_window,
  rar.status AS action_status,
  rar.executed_at,
  fpe.id AS forecast_id,
  fpe.predicted_at,
  fpe.realized_at AS forecast_realized_at,
  fpe.direction_hit,
  fpe.absolute_error,
  fpe.evaluation_locked,
  CASE
    WHEN dol.net_value IS NOT NULL AND rar.estimated_roi_eur IS NOT NULL AND rar.estimated_roi_eur <> 0
      THEN ROUND((dol.net_value / rar.estimated_roi_eur)::numeric, 3)
    ELSE NULL
  END AS roi_realization_ratio
FROM public.decision_outcome_log dol
LEFT JOIN public.risk_action_recommendations rar
  ON rar.country_iso3 = dol.iso3
 AND rar.domain = dol.domain
 AND rar.executed_at IS NOT NULL
 AND rar.executed_at <= COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at)
 AND rar.executed_at > COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at) - interval '60 days'
LEFT JOIN public.forecast_prospective_evaluations fpe
  ON fpe.iso3 = dol.iso3
 AND fpe.domain = dol.domain
 AND fpe.evaluation_locked = true
 AND fpe.realized_at <= COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at)
 AND fpe.realized_at > COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at) - interval '90 days';

COMMENT ON VIEW public.pilot_truth_feed IS 'Wave 1: outcomes joined with executed actions + locked realized forecasts. Externally defensible (forecast must be locked).';

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_rar_country_domain_executed ON public.risk_action_recommendations(country_iso3, domain, executed_at) WHERE executed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fpe_iso3_domain_realized ON public.forecast_prospective_evaluations(iso3, domain, realized_at) WHERE realized_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rar_status_created ON public.risk_action_recommendations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_dol_iso3_domain_outcome ON public.decision_outcome_log(iso3, domain, outcome_timestamp);