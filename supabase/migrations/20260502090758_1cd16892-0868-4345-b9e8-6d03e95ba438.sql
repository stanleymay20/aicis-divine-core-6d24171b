
-- Wave 1B: Risk Action Executor lifecycle

-- 1. Add missing lifecycle columns
ALTER TABLE public.risk_action_recommendations
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by uuid,
  ADD COLUMN IF NOT EXISTS dismissal_reason text,
  ADD COLUMN IF NOT EXISTS executed_by uuid,
  ADD COLUMN IF NOT EXISTS execution_note text,
  ADD COLUMN IF NOT EXISTS outcome_logged_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_logged_by uuid,
  ADD COLUMN IF NOT EXISTS linked_outcome_id uuid;

CREATE INDEX IF NOT EXISTS idx_rar_lifecycle ON public.risk_action_recommendations(status, dismissed_at, outcome_logged_at);

-- 2. Tighten lifecycle UPDATE policy: only admin/operator
DROP POLICY IF EXISTS "Authenticated users can update recommendation lifecycle"
  ON public.risk_action_recommendations;

CREATE POLICY "Admin/operator can update recommendation lifecycle"
  ON public.risk_action_recommendations
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'operator'::app_role))
    AND status = ANY (ARRAY['proposed','accepted','dismissed','executed','outcome_logged','expired'])
  );

-- 3. SECURITY DEFINER lifecycle transition fn (audit-logged)
CREATE OR REPLACE FUNCTION public.transition_risk_action(
  p_action_id uuid,
  p_to_status text,
  p_dismissal_reason text DEFAULT NULL,
  p_execution_note text DEFAULT NULL,
  p_outcome_id uuid DEFAULT NULL
)
RETURNS public.risk_action_recommendations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.risk_action_recommendations;
  v_audit_action text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'operator'::app_role)) THEN
    RAISE EXCEPTION 'Insufficient privileges: admin or operator required';
  END IF;

  IF p_to_status NOT IN ('accepted','dismissed','executed','outcome_logged') THEN
    RAISE EXCEPTION 'Invalid target status: %', p_to_status;
  END IF;

  -- Apply transition
  UPDATE public.risk_action_recommendations
  SET
    status            = p_to_status,
    accepted_at       = CASE WHEN p_to_status = 'accepted'       AND accepted_at       IS NULL THEN now() ELSE accepted_at END,
    accepted_by       = CASE WHEN p_to_status = 'accepted'       AND accepted_by       IS NULL THEN v_uid ELSE accepted_by END,
    dismissed_at      = CASE WHEN p_to_status = 'dismissed'      THEN now()             ELSE dismissed_at END,
    dismissed_by      = CASE WHEN p_to_status = 'dismissed'      THEN v_uid             ELSE dismissed_by END,
    dismissal_reason  = CASE WHEN p_to_status = 'dismissed'      THEN p_dismissal_reason ELSE dismissal_reason END,
    executed_at       = CASE WHEN p_to_status = 'executed'       AND executed_at       IS NULL THEN now() ELSE executed_at END,
    executed_by       = CASE WHEN p_to_status = 'executed'       AND executed_by       IS NULL THEN v_uid ELSE executed_by END,
    execution_note    = CASE WHEN p_to_status = 'executed'       THEN COALESCE(p_execution_note, execution_note) ELSE execution_note END,
    outcome_logged_at = CASE WHEN p_to_status = 'outcome_logged' THEN now()             ELSE outcome_logged_at END,
    outcome_logged_by = CASE WHEN p_to_status = 'outcome_logged' THEN v_uid             ELSE outcome_logged_by END,
    linked_outcome_id = CASE WHEN p_to_status = 'outcome_logged' THEN COALESCE(p_outcome_id, linked_outcome_id) ELSE linked_outcome_id END,
    updated_at        = now()
  WHERE id = p_action_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Risk action not found: %', p_action_id;
  END IF;

  -- Audit
  v_audit_action := CASE p_to_status
    WHEN 'accepted'       THEN 'decision.accepted'
    WHEN 'dismissed'      THEN 'decision.rejected'
    WHEN 'executed'       THEN 'execution.completed'
    WHEN 'outcome_logged' THEN 'outcome.recorded'
  END;

  INSERT INTO public.audit_log (user_id, action, resource_type, resource_id, severity, metadata)
  VALUES (
    v_uid,
    v_audit_action,
    'risk_action_recommendation',
    p_action_id::text,
    'info',
    jsonb_build_object(
      'to_status',         p_to_status,
      'country_iso3',      v_row.country_iso3,
      'domain',            v_row.domain,
      'intervention_type', v_row.intervention_type,
      'dismissal_reason',  p_dismissal_reason,
      'execution_note',    p_execution_note,
      'linked_outcome_id', p_outcome_id,
      'estimated_roi_eur', v_row.estimated_roi_eur
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_risk_action(uuid, text, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.transition_risk_action(uuid, text, text, text, uuid) TO authenticated;

-- 4. Recreate pilot_truth_feed: include accepted/executed actions even without an outcome row
DROP VIEW IF EXISTS public.pilot_truth_feed;

CREATE VIEW public.pilot_truth_feed
WITH (security_invoker = true)
AS
WITH outcome_side AS (
  SELECT
    dol.id  AS outcome_id,
    COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at) AS event_at,
    dol.iso3, dol.domain,
    dol.signal_title, dol.recommended_action,
    dol.action_taken, dol.outcome_success,
    dol.measured_impact_score, dol.roi_estimate, dol.net_value,
    dol.review_status,
    rar.id  AS action_id,
    rar.intervention_type, rar.intervention_title,
    rar.estimated_roi_eur, rar.urgency_window,
    rar.status            AS action_status,
    rar.accepted_at, rar.executed_at, rar.dismissed_at, rar.outcome_logged_at,
    fpe.id                AS forecast_id,
    fpe.predicted_at, fpe.realized_at AS forecast_realized_at,
    fpe.direction_hit, fpe.absolute_error, fpe.evaluation_locked
  FROM public.decision_outcome_log dol
  LEFT JOIN public.risk_action_recommendations rar
    ON rar.country_iso3 = dol.iso3
   AND rar.domain       = dol.domain
   AND rar.executed_at IS NOT NULL
   AND rar.executed_at <= COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at)
   AND rar.executed_at  > COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at) - INTERVAL '60 days'
  LEFT JOIN public.forecast_prospective_evaluations fpe
    ON fpe.iso3              = dol.iso3
   AND fpe.domain            = dol.domain
   AND fpe.evaluation_locked = true
   AND fpe.realized_at <= COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at)
   AND fpe.realized_at  > COALESCE(dol.outcome_timestamp, dol.recorded_at, dol.created_at) - INTERVAL '90 days'
),
action_only AS (
  SELECT
    NULL::uuid                                AS outcome_id,
    COALESCE(rar.executed_at, rar.accepted_at, rar.created_at) AS event_at,
    rar.country_iso3                          AS iso3,
    rar.domain                                AS domain,
    rar.intervention_title                    AS signal_title,
    rar.intervention_title                    AS recommended_action,
    NULL::boolean                             AS action_taken,
    NULL::boolean                             AS outcome_success,
    NULL::numeric                             AS measured_impact_score,
    NULL::numeric                             AS roi_estimate,
    NULL::numeric                             AS net_value,
    NULL::text                                AS review_status,
    rar.id                                    AS action_id,
    rar.intervention_type, rar.intervention_title,
    rar.estimated_roi_eur, rar.urgency_window,
    rar.status                                AS action_status,
    rar.accepted_at, rar.executed_at, rar.dismissed_at, rar.outcome_logged_at,
    NULL::uuid                                AS forecast_id,
    NULL::timestamptz                         AS predicted_at,
    NULL::timestamptz                         AS forecast_realized_at,
    NULL::boolean                             AS direction_hit,
    NULL::numeric                             AS absolute_error,
    NULL::boolean                             AS evaluation_locked
  FROM public.risk_action_recommendations rar
  WHERE rar.status IN ('accepted','executed','outcome_logged')
    AND NOT EXISTS (
      SELECT 1 FROM outcome_side os WHERE os.action_id = rar.id
    )
)
SELECT
  outcome_id,
  event_at AS outcome_recorded_at,
  iso3, domain, signal_title, recommended_action,
  action_taken, outcome_success, measured_impact_score, roi_estimate, net_value,
  review_status,
  action_id, intervention_type, intervention_title, estimated_roi_eur, urgency_window,
  action_status, accepted_at, executed_at, dismissed_at, outcome_logged_at,
  forecast_id, predicted_at, forecast_realized_at, direction_hit, absolute_error, evaluation_locked,
  CASE
    WHEN net_value IS NOT NULL AND estimated_roi_eur IS NOT NULL AND estimated_roi_eur <> 0
      THEN round(net_value / estimated_roi_eur, 3)
    ELSE NULL
  END AS roi_realization_ratio
FROM (
  SELECT * FROM outcome_side
  UNION ALL
  SELECT * FROM action_only
) merged;

-- 5. Lifecycle metrics view
CREATE OR REPLACE VIEW public.risk_action_lifecycle_metrics
WITH (security_invoker = true)
AS
SELECT
  count(*) FILTER (WHERE status = 'proposed')                                                AS proposed_count,
  count(*) FILTER (WHERE status = 'accepted')                                                AS accepted_count,
  count(*) FILTER (WHERE status = 'dismissed')                                               AS dismissed_count,
  count(*) FILTER (WHERE status = 'executed')                                                AS executed_count,
  count(*) FILTER (WHERE status = 'outcome_logged')                                          AS outcome_logged_count,
  count(*) FILTER (WHERE status = 'expired')                                                 AS expired_count,
  count(*) FILTER (WHERE status = 'proposed'
                   AND created_at < now() - (urgency_hours || ' hours')::interval)           AS stale_proposed_count,
  CASE WHEN count(*) FILTER (WHERE status = 'proposed') + count(*) FILTER (WHERE status IN ('accepted','executed','outcome_logged','dismissed')) = 0
       THEN 0
       ELSE round(
         count(*) FILTER (WHERE status IN ('accepted','executed','outcome_logged'))::numeric
         / NULLIF(count(*) FILTER (WHERE status IN ('proposed','accepted','executed','outcome_logged','dismissed','expired')), 0), 3)
  END AS action_conversion_rate
FROM public.risk_action_recommendations;

GRANT SELECT ON public.risk_action_lifecycle_metrics TO authenticated;
GRANT SELECT ON public.pilot_truth_feed TO authenticated;
