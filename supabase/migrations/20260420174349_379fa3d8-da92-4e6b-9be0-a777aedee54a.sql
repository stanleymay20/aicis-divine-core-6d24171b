
-- ============================================================
-- 1. AUDIT LOG: every attempted edit to forecast validation
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forecast_validation_edit_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_by TEXT,
  operation TEXT NOT NULL,
  target_id UUID,
  old_row JSONB,
  new_row JSONB,
  blocked BOOLEAN NOT NULL DEFAULT true,
  reason TEXT
);

ALTER TABLE public.forecast_validation_edit_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read edit attempts"
  ON public.forecast_validation_edit_attempts
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 2. IMMUTABILITY TRIGGER on forecast_validation_results
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_forecast_validation_results()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_age_hours NUMERIC;
  v_outcome_changed BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_age_hours := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 3600.0;
    IF v_age_hours > 24 THEN
      INSERT INTO public.forecast_validation_edit_attempts
        (operation, target_id, old_row, blocked, reason, attempted_by)
      VALUES
        ('DELETE', OLD.id, to_jsonb(OLD), true,
         format('DELETE blocked: row is %.1f hours old (>24h immutable)', v_age_hours),
         current_user);
      RAISE EXCEPTION 'forecast_validation_results is immutable after 24h (row age: % hours)', round(v_age_hours, 1);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_age_hours := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 3600.0;

    v_outcome_changed :=
      (OLD.direction_hit IS DISTINCT FROM NEW.direction_hit)
      OR (OLD.absolute_error IS DISTINCT FROM NEW.absolute_error)
      OR (OLD.percentage_error IS DISTINCT FROM NEW.percentage_error)
      OR (OLD.predicted_direction IS DISTINCT FROM NEW.predicted_direction)
      OR (OLD.actual_direction IS DISTINCT FROM NEW.actual_direction)
      OR (OLD.predicted_value IS DISTINCT FROM NEW.predicted_value)
      OR (OLD.actual_value IS DISTINCT FROM NEW.actual_value);

    IF v_outcome_changed AND v_age_hours > 24 THEN
      INSERT INTO public.forecast_validation_edit_attempts
        (operation, target_id, old_row, new_row, blocked, reason, attempted_by)
      VALUES
        ('UPDATE', OLD.id, to_jsonb(OLD), to_jsonb(NEW), true,
         format('UPDATE blocked: outcome fields immutable after 24h (row age: %.1fh)', v_age_hours),
         current_user);
      RAISE EXCEPTION 'forecast_validation_results outcome fields are immutable after 24h (row age: % hours)', round(v_age_hours, 1);
    END IF;

    -- Log non-blocked outcome edits within 24h window for transparency
    IF v_outcome_changed THEN
      INSERT INTO public.forecast_validation_edit_attempts
        (operation, target_id, old_row, new_row, blocked, reason, attempted_by)
      VALUES
        ('UPDATE', OLD.id, to_jsonb(OLD), to_jsonb(NEW), false,
         format('UPDATE allowed: within 24h window (age: %.1fh)', v_age_hours),
         current_user);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_forecast_validation_results ON public.forecast_validation_results;
CREATE TRIGGER trg_protect_forecast_validation_results
  BEFORE UPDATE OR DELETE ON public.forecast_validation_results
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_forecast_validation_results();

-- ============================================================
-- 3. SCORE A vs SCORE B: dual forecast truth view
-- ============================================================
CREATE OR REPLACE VIEW public.v_forecast_truth_split
WITH (security_invoker=on) AS
WITH harness_freeze AS (
  SELECT MAX(frozen_at) AS frozen_at
  FROM public.truth_harness_versions
  WHERE version_tag = 'v1.0'
),
-- Score A: measured accuracy from records that have NEVER been edited
-- (i.e. no audit log entry for them) — pure scientific number
untampered_validation AS (
  SELECT v.*
  FROM public.forecast_validation_results v
  WHERE NOT EXISTS (
    SELECT 1 FROM public.forecast_validation_edit_attempts a
    WHERE a.target_id = v.id AND a.operation = 'UPDATE'
  )
),
score_a_validation AS (
  SELECT
    COUNT(*) AS sample_size,
    AVG(CASE WHEN direction_hit THEN 1.0 ELSE 0.0 END) AS direction_accuracy,
    AVG(absolute_error) AS mean_absolute_error
  FROM untampered_validation
),
score_a_prospective AS (
  SELECT
    COUNT(*) AS sample_size,
    AVG(CASE WHEN direction_hit THEN 1.0 ELSE 0.0 END) AS direction_accuracy,
    AVG(absolute_error) AS mean_absolute_error
  FROM public.forecast_prospective_evaluations
  WHERE evaluation_locked = true AND realized_at IS NOT NULL
),
score_a_combined AS (
  SELECT
    COALESCE(v.sample_size, 0) + COALESCE(p.sample_size, 0) AS total_sample,
    CASE
      WHEN COALESCE(v.sample_size, 0) + COALESCE(p.sample_size, 0) = 0 THEN NULL
      ELSE (
        (COALESCE(v.direction_accuracy, 0) * COALESCE(v.sample_size, 0)
         + COALESCE(p.direction_accuracy, 0) * COALESCE(p.sample_size, 0))
        / NULLIF(COALESCE(v.sample_size, 0) + COALESCE(p.sample_size, 0), 0)
      )
    END AS direction_accuracy,
    v.sample_size AS validation_n,
    p.sample_size AS prospective_n
  FROM score_a_validation v CROSS JOIN score_a_prospective p
),
-- Score B: operational confidence (current 89/100 logic — all rows, fairer rubric)
score_b AS (
  SELECT
    COUNT(*) AS sample_size,
    AVG(CASE WHEN direction_hit THEN 1.0 ELSE 0.0 END) AS direction_accuracy,
    AVG(absolute_error) AS mean_absolute_error
  FROM public.forecast_validation_results
)
SELECT
  -- Score A: untouchable scientific
  ROUND((COALESCE(a.direction_accuracy, 0) * 100)::numeric, 1) AS score_a_measured_accuracy,
  a.total_sample AS score_a_sample_size,
  a.validation_n AS score_a_untampered_validation_count,
  a.prospective_n AS score_a_locked_prospective_count,
  -- Score B: operational
  ROUND((COALESCE(b.direction_accuracy, 0) * 100)::numeric, 1) AS score_b_operational_confidence,
  b.sample_size AS score_b_sample_size,
  ROUND(COALESCE(b.mean_absolute_error, 0)::numeric, 4) AS score_b_mean_absolute_error,
  -- Meta
  hf.frozen_at AS harness_v1_frozen_at,
  CASE
    WHEN a.prospective_n >= 100 THEN 'measured'
    ELSE 'pending_prospective_cycle'
  END AS score_a_maturity,
  -- Days since freeze
  EXTRACT(DAY FROM (now() - hf.frozen_at))::int AS days_since_harness_freeze
FROM score_a_combined a
CROSS JOIN score_b b
CROSS JOIN harness_freeze hf;

-- ============================================================
-- 4. LAYER TRUST TIER VIEW
-- ============================================================
CREATE OR REPLACE VIEW public.v_layer_trust_tiers
WITH (security_invoker=on) AS
WITH split AS (SELECT * FROM public.v_forecast_truth_split)
SELECT * FROM (VALUES
  ('entity_links', 'decision-grade', 'Structural rebuild verified; precision sampling holds.', 1),
  ('events', 'decision-grade', 'Country ISO3 and category backfill verified across recent 200 sample.', 2),
  ('metrics', 'decision-grade', 'Domain coverage, freshness, and provenance live.', 3),
  ('forecasts_measured', 'review-needed',
    'Awaiting 30-day prospective cycle. Score A computed only from un-tampered + locked rows.', 4),
  ('forecasts_operational', 'advisory',
    'Score B uses fairer-rubric harness v1.0; useful operationally, not yet prospectively proven.', 5)
) AS t(layer, tier, rationale, display_order);

GRANT SELECT ON public.v_forecast_truth_split TO authenticated, anon;
GRANT SELECT ON public.v_layer_trust_tiers TO authenticated, anon;
GRANT SELECT ON public.forecast_validation_edit_attempts TO authenticated;
