
-- 1) Add columns
ALTER TABLE public.decision_outcome_log
  ADD COLUMN IF NOT EXISTS outcome_confidence text,
  ADD COLUMN IF NOT EXISTS evidence_url text,
  ADD COLUMN IF NOT EXISTS evidence_quality_score numeric(3,2),
  ADD COLUMN IF NOT EXISTS evidence_checklist jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decision_outcome_log_confidence_chk') THEN
    ALTER TABLE public.decision_outcome_log
      ADD CONSTRAINT decision_outcome_log_confidence_chk
      CHECK (outcome_confidence IS NULL OR outcome_confidence IN ('low','medium','high','unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dol_evidence_quality ON public.decision_outcome_log(evidence_quality_score);

-- 2) Validation + scoring trigger
CREATE OR REPLACE FUNCTION public.compute_outcome_evidence_quality()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_score numeric(3,2) := 0;
  v_has_url boolean := false;
  v_has_source boolean := false;
  v_has_measured boolean := false;
  v_has_notes boolean := false;
  v_notes_text text;
  v_url_valid boolean := false;
BEGIN
  v_notes_text := COALESCE(NEW.measured_outcome, '') || ' ' || COALESCE(NEW.evidence_note, '');
  v_has_url      := NEW.evidence_url IS NOT NULL AND length(trim(NEW.evidence_url)) > 0;
  v_url_valid    := v_has_url AND NEW.evidence_url ~* '^https?://';
  v_has_source   := NEW.evidence_source_type IS NOT NULL AND NEW.evidence_source_type NOT IN ('operator','');
  v_has_measured := NEW.net_value IS NOT NULL OR NEW.roi_estimate IS NOT NULL OR NEW.measured_impact_score IS NOT NULL;
  v_has_notes    := length(trim(v_notes_text)) >= 30;

  IF NEW.outcome_success IS NOT NULL AND NOT (v_url_valid OR v_has_notes) THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: outcome_success set but no evidence_url (https://...) and notes < 30 chars'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.net_value IS NOT NULL AND NOT (v_url_valid OR v_has_notes) THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: net_value provided but no evidence_url and measurement note < 30 chars'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_has_url AND NOT v_url_valid THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_URL: evidence_url must start with http:// or https://'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_url_valid     THEN v_score := v_score + 0.30; END IF;
  IF v_has_source    THEN v_score := v_score + 0.20; END IF;
  IF v_has_measured  THEN v_score := v_score + 0.20; END IF;
  IF v_has_notes     THEN v_score := v_score + 0.20; END IF;
  IF NEW.outcome_confidence = 'high'   THEN v_score := v_score + 0.10;
  ELSIF NEW.outcome_confidence = 'medium' THEN v_score := v_score + 0.05;
  END IF;
  IF v_score > 1 THEN v_score := 1; END IF;

  NEW.evidence_quality_score := v_score;
  NEW.evidence_checklist := jsonb_build_object(
    'evidence_url_provided',        v_url_valid,
    'evidence_source_type_selected',v_has_source,
    'measured_value_known',         v_has_measured,
    'notes_provided',               v_has_notes,
    'outcome_confidence',           COALESCE(NEW.outcome_confidence, 'unknown')
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_compute_outcome_evidence_quality ON public.decision_outcome_log;
CREATE TRIGGER trg_compute_outcome_evidence_quality
  BEFORE INSERT OR UPDATE OF outcome_success, net_value, evidence_url,
                             evidence_source_type, evidence_note, measured_outcome,
                             outcome_confidence, roi_estimate, measured_impact_score
  ON public.decision_outcome_log
  FOR EACH ROW EXECUTE FUNCTION public.compute_outcome_evidence_quality();

UPDATE public.decision_outcome_log
   SET evidence_quality_score = 0,
       evidence_checklist = jsonb_build_object(
         'evidence_url_provided',        false,
         'evidence_source_type_selected',false,
         'measured_value_known',         (net_value IS NOT NULL OR roi_estimate IS NOT NULL),
         'notes_provided',               (length(coalesce(measured_outcome,'') || coalesce(evidence_note,'')) >= 30),
         'outcome_confidence',           'unknown'
       )
 WHERE evidence_quality_score IS NULL;

-- 3) Recreate learning views (drop first to allow column reorder)
DROP VIEW IF EXISTS public.risk_action_performance_summary CASCADE;
CREATE VIEW public.risk_action_performance_summary
WITH (security_invoker = true) AS
SELECT
  r.country_iso3,
  r.domain,
  r.intervention_type,
  COUNT(*) FILTER (WHERE r.accepted_at IS NOT NULL)              AS accepted_count,
  COUNT(*) FILTER (WHERE r.executed_at IS NOT NULL)              AS executed_count,
  COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL)        AS outcome_logged_count,
  COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                    AND COALESCE(o.evidence_quality_score,0) >= 0.5) AS strong_outcome_count,
  COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                    AND COALESCE(o.evidence_quality_score,0) <  0.5) AS weak_outcome_count,
  COUNT(*) FILTER (WHERE r.status = 'dismissed')                 AS dismissed_count,
  COUNT(*) FILTER (WHERE r.status = 'expired')                   AS expired_count,
  COUNT(*)                                                       AS total_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                           AND COALESCE(o.evidence_quality_score,0) >= 0.5
                           AND o.outcome_success IS NOT NULL) = 0 THEN NULL
    ELSE ROUND(
      COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                        AND COALESCE(o.evidence_quality_score,0) >= 0.5
                        AND o.outcome_success = true)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                                 AND COALESCE(o.evidence_quality_score,0) >= 0.5
                                 AND o.outcome_success IS NOT NULL), 0)::numeric,
      4
    )
  END AS success_rate,
  ROUND(AVG(o.net_value) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                                  AND COALESCE(o.evidence_quality_score,0) >= 0.5
                                  AND o.net_value IS NOT NULL)::numeric, 2) AS avg_net_value,
  ROUND(
    AVG(
      CASE WHEN r.outcome_logged_at IS NOT NULL
            AND COALESCE(o.evidence_quality_score,0) >= 0.5
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

DROP VIEW IF EXISTS public.recommendation_quality_score CASCADE;
CREATE VIEW public.recommendation_quality_score
WITH (security_invoker = true) AS
WITH base AS (
  SELECT
    r.intervention_type,
    COUNT(*)                                                  AS total_proposed,
    COUNT(*) FILTER (WHERE r.accepted_at IS NOT NULL)         AS accepted_n,
    COUNT(*) FILTER (WHERE r.executed_at IS NOT NULL)         AS executed_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL)   AS outcome_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                      AND COALESCE(o.evidence_quality_score,0) >= 0.5) AS strong_outcome_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                      AND COALESCE(o.evidence_quality_score,0) <  0.5) AS weak_outcome_n,
    COUNT(*) FILTER (WHERE r.status = 'dismissed')            AS dismissed_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                      AND COALESCE(o.evidence_quality_score,0) >= 0.5
                      AND o.outcome_success = true)           AS success_n,
    COUNT(*) FILTER (WHERE r.outcome_logged_at IS NOT NULL
                      AND COALESCE(o.evidence_quality_score,0) >= 0.5
                      AND o.outcome_success IS NOT NULL)      AS scored_n,
    AVG(
      CASE WHEN r.outcome_logged_at IS NOT NULL
            AND COALESCE(o.evidence_quality_score,0) >= 0.5
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
  intervention_type, total_proposed, accepted_n, executed_n, outcome_n,
  strong_outcome_n, weak_outcome_n, dismissed_n, success_n, scored_n,
  ROUND(avg_roi_real::numeric, 4) AS avg_roi_realization,
  ROUND((CASE WHEN total_proposed > 0 THEN executed_n::numeric / total_proposed ELSE 0 END)::numeric, 4) AS execution_rate,
  ROUND((CASE WHEN scored_n > 0 THEN success_n::numeric / scored_n ELSE 0 END)::numeric, 4) AS success_rate,
  ROUND((CASE WHEN total_proposed > 0 THEN dismissed_n::numeric / total_proposed ELSE 0 END)::numeric, 4) AS dismissal_rate,
  ROUND(LEAST(strong_outcome_n::numeric / 30.0, 1.0)::numeric, 4) AS sample_confidence,
  ROUND((
    LEAST(strong_outcome_n::numeric / 30.0, 1.0) *
      ( 0.40 * (CASE WHEN total_proposed > 0 THEN executed_n::numeric / total_proposed ELSE 0 END)
      + 0.35 * (CASE WHEN scored_n > 0 THEN success_n::numeric / scored_n ELSE 0 END)
      + 0.25 * LEAST(COALESCE(avg_roi_real, 0) / 1.5, 1.0))
    + (1 - LEAST(strong_outcome_n::numeric / 30.0, 1.0)) * 0.5
  )::numeric, 4) AS quality_score,
  format(
    'execution=%s%% (%s/%s) · success=%s%% (%s/%s strong) · ROI realized=%sx · evidence-confidence=%s%% (strong n=%s, weak excluded=%s)',
    ROUND((CASE WHEN total_proposed > 0 THEN executed_n::numeric * 100 / total_proposed ELSE 0 END), 1),
    executed_n, total_proposed,
    ROUND((CASE WHEN scored_n > 0 THEN success_n::numeric * 100 / scored_n ELSE 0 END), 1),
    success_n, scored_n,
    COALESCE(ROUND(avg_roi_real::numeric, 2)::text, '—'),
    ROUND(LEAST(strong_outcome_n::numeric / 30.0, 1.0) * 100, 0),
    strong_outcome_n, weak_outcome_n
  ) AS score_explanation
FROM base;

GRANT SELECT ON public.risk_action_performance_summary TO authenticated;
GRANT SELECT ON public.recommendation_quality_score TO authenticated;

-- 4) Badge view
CREATE OR REPLACE VIEW public.pilot_outcome_evidence_badges
WITH (security_invoker = true) AS
SELECT
  o.id AS outcome_id,
  o.evidence_quality_score,
  o.outcome_confidence,
  o.outcome_success,
  o.evidence_checklist,
  CASE
    WHEN o.outcome_success IS NULL                          THEN 'inconclusive'
    WHEN COALESCE(o.evidence_quality_score, 0) >= 0.7       THEN 'strong'
    WHEN COALESCE(o.evidence_quality_score, 0) >= 0.5       THEN 'acceptable'
    ELSE 'weak'
  END AS evidence_badge,
  (COALESCE(o.evidence_quality_score, 0) < 0.5
    OR o.outcome_success IS NULL)                            AS excluded_from_learning
FROM public.decision_outcome_log o;

GRANT SELECT ON public.pilot_outcome_evidence_badges TO authenticated;
