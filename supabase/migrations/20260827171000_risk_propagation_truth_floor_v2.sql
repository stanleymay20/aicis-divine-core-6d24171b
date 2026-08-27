-- AICIS risk propagation truth floor v2
--
-- Propagation is a deterministic analytical screen, not a probability. The
-- legacy engine silently substituted cross-border intensity 0.5. v2 requires a
-- quantified origin model output and a quantified edge intensity, otherwise it
-- records an append-only abstention.

ALTER TABLE public.cross_border_signals
  ALTER COLUMN intensity DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS intensity_semantics text,
  ADD COLUMN IF NOT EXISTS reported_intensity numeric,
  ADD COLUMN IF NOT EXISTS detected_at_semantics text;

UPDATE public.cross_border_signals
SET
  intensity_semantics = COALESCE(
    intensity_semantics,
    CASE WHEN intensity IS NOT NULL THEN 'legacy_cross_border_intensity_semantics_unverified' END
  ),
  detected_at_semantics = COALESCE(
    detected_at_semantics,
    'legacy_detection_timestamp_semantics_unverified'
  );

CREATE OR REPLACE FUNCTION public.guard_cross_border_signal_truth_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.intensity IS NOT NULL AND (
    NEW.intensity_semantics IS NULL
    OR btrim(NEW.intensity_semantics) = ''
    OR lower(NEW.intensity_semantics) LIKE '%legacy%'
    OR lower(NEW.intensity_semantics) LIKE '%unknown%'
    OR lower(NEW.intensity_semantics) LIKE '%unverified%'
    OR lower(NEW.intensity_semantics) LIKE '%unlabeled%'
    OR lower(NEW.intensity_semantics) LIKE '%withheld%'
    OR lower(NEW.intensity_semantics) LIKE '%not_quantified%'
  ) THEN
    NEW.reported_intensity := COALESCE(NEW.reported_intensity, NEW.intensity);
    NEW.intensity := NULL;
    NEW.intensity_semantics := 'withheld_unlabeled_cross_border_intensity';
  END IF;

  IF TG_OP = 'INSERT' AND (NEW.detected_at_semantics IS NULL OR btrim(NEW.detected_at_semantics) = '') THEN
    NEW.detected_at_semantics := 'aicis_system_detection_time_v1';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_cross_border_signal_truth_v2 ON public.cross_border_signals;
CREATE TRIGGER trg_guard_cross_border_signal_truth_v2
BEFORE INSERT OR UPDATE ON public.cross_border_signals
FOR EACH ROW EXECUTE FUNCTION public.guard_cross_border_signal_truth_v2();

REVOKE ALL ON FUNCTION public.guard_cross_border_signal_truth_v2() FROM PUBLIC;

ALTER TABLE public.risk_propagation_score
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS propagation_semantics text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS origin_input_semantics text,
  ADD COLUMN IF NOT EXISTS edge_intensity_semantics text,
  ADD COLUMN IF NOT EXISTS source_prediction_id uuid REFERENCES public.risk_ml_predictions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_cross_border_signal_id uuid REFERENCES public.cross_border_signals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_snapshot_date date;

CREATE TABLE IF NOT EXISTS public.risk_propagation_abstentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_batch_id uuid NOT NULL,
  origin_iso3 text NOT NULL,
  domain text NOT NULL,
  affected_iso3 text[] NOT NULL DEFAULT '{}',
  source_prediction_id uuid REFERENCES public.risk_ml_predictions(id) ON DELETE SET NULL,
  source_cross_border_signal_id uuid REFERENCES public.cross_border_signals(id) ON DELETE SET NULL,
  origin_input_semantics text,
  edge_intensity_semantics text,
  reason_code text NOT NULL,
  reason_detail text,
  retryable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_propagation_abstentions_batch
  ON public.risk_propagation_abstentions(generation_batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_propagation_abstentions_origin
  ON public.risk_propagation_abstentions(origin_iso3, domain, created_at DESC);

ALTER TABLE public.risk_propagation_abstentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read risk propagation abstentions"
  ON public.risk_propagation_abstentions;
CREATE POLICY "Authenticated read risk propagation abstentions"
  ON public.risk_propagation_abstentions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role writes risk propagation abstentions"
  ON public.risk_propagation_abstentions;
CREATE POLICY "Service role writes risk propagation abstentions"
  ON public.risk_propagation_abstentions FOR INSERT TO service_role WITH CHECK (true);
GRANT SELECT ON public.risk_propagation_abstentions TO authenticated;
GRANT SELECT, INSERT ON public.risk_propagation_abstentions TO service_role;

DROP TRIGGER IF EXISTS trg_risk_propagation_abstentions_immutable
  ON public.risk_propagation_abstentions;
CREATE TRIGGER trg_risk_propagation_abstentions_immutable
  BEFORE UPDATE OR DELETE ON public.risk_propagation_abstentions
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

CREATE OR REPLACE FUNCTION public.compute_risk_propagation()
RETURNS TABLE(batch_id uuid, rows_inserted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_count bigint := 0;
BEGIN
  -- Record recent cross-border signals that cannot be quantified because a
  -- sufficient origin inference does not exist.
  WITH latest_any AS (
    SELECT DISTINCT ON (country_iso3, domain)
      id,
      country_iso3,
      domain,
      risk_probability,
      evidence_status,
      probability_semantics,
      source_snapshot_date,
      generated_at
    FROM public.risk_ml_predictions
    ORDER BY country_iso3, domain, generated_at DESC
  )
  INSERT INTO public.risk_propagation_abstentions (
    generation_batch_id,
    origin_iso3,
    domain,
    affected_iso3,
    source_prediction_id,
    source_cross_border_signal_id,
    origin_input_semantics,
    edge_intensity_semantics,
    reason_code,
    reason_detail
  )
  SELECT
    v_batch,
    c.origin_iso3,
    c.domain,
    c.affected_iso3,
    p.id,
    c.id,
    p.probability_semantics,
    c.intensity_semantics,
    'origin_prediction_not_eligible',
    CASE
      WHEN p.id IS NULL THEN 'No origin inference is available for this country/domain.'
      WHEN p.evidence_status <> 'sufficient' THEN 'Latest origin inference does not have sufficient evidence.'
      WHEN p.probability_semantics NOT IN (
        'uncalibrated_logistic_screen_score',
        'empirical_bin_calibrated_probability'
      ) THEN 'Latest origin inference semantics are not eligible for propagation.'
      WHEN p.risk_probability IS NULL THEN 'Latest origin inference has no numeric screen/probability value.'
      ELSE 'Origin inference is not eligible for propagation.'
    END
  FROM public.cross_border_signals c
  LEFT JOIN latest_any p
    ON p.country_iso3 = c.origin_iso3
   AND p.domain = c.domain
  WHERE c.detected_at > now() - interval '90 days'
    AND (
      p.id IS NULL
      OR p.evidence_status <> 'sufficient'
      OR p.probability_semantics NOT IN (
        'uncalibrated_logistic_screen_score',
        'empirical_bin_calibrated_probability'
      )
      OR p.risk_probability IS NULL
    );

  -- Record edges whose origin inference is usable but whose transmission
  -- intensity is absent or semantically unqualified.
  WITH latest_eligible AS (
    SELECT DISTINCT ON (country_iso3, domain)
      id,
      country_iso3,
      domain,
      risk_probability,
      probability_semantics,
      source_snapshot_date,
      generated_at
    FROM public.risk_ml_predictions
    WHERE evidence_status = 'sufficient'
      AND probability_semantics IN (
        'uncalibrated_logistic_screen_score',
        'empirical_bin_calibrated_probability'
      )
      AND risk_probability IS NOT NULL
    ORDER BY country_iso3, domain, generated_at DESC
  )
  INSERT INTO public.risk_propagation_abstentions (
    generation_batch_id,
    origin_iso3,
    domain,
    affected_iso3,
    source_prediction_id,
    source_cross_border_signal_id,
    origin_input_semantics,
    edge_intensity_semantics,
    reason_code,
    reason_detail
  )
  SELECT
    v_batch,
    c.origin_iso3,
    c.domain,
    c.affected_iso3,
    p.id,
    c.id,
    p.probability_semantics,
    c.intensity_semantics,
    'edge_intensity_not_quantified',
    'Cross-border intensity is missing or does not have usable quantitative semantics; no fallback intensity is applied.'
  FROM public.cross_border_signals c
  JOIN latest_eligible p
    ON p.country_iso3 = c.origin_iso3
   AND p.domain = c.domain
  WHERE c.detected_at > now() - interval '90 days'
    AND (
      c.intensity IS NULL
      OR c.intensity_semantics IS NULL
      OR btrim(c.intensity_semantics) = ''
      OR lower(c.intensity_semantics) LIKE '%legacy%'
      OR lower(c.intensity_semantics) LIKE '%unknown%'
      OR lower(c.intensity_semantics) LIKE '%unverified%'
      OR lower(c.intensity_semantics) LIKE '%unlabeled%'
      OR lower(c.intensity_semantics) LIKE '%withheld%'
      OR lower(c.intensity_semantics) LIKE '%not_quantified%'
    );

  WITH latest_eligible AS (
    SELECT DISTINCT ON (country_iso3, domain)
      id,
      country_iso3,
      domain,
      risk_probability,
      probability_semantics,
      source_snapshot_date,
      generated_at
    FROM public.risk_ml_predictions
    WHERE evidence_status = 'sufficient'
      AND probability_semantics IN (
        'uncalibrated_logistic_screen_score',
        'empirical_bin_calibrated_probability'
      )
      AND risk_probability IS NOT NULL
    ORDER BY country_iso3, domain, generated_at DESC
  ), eligible_edges AS (
    SELECT
      c.id AS cross_border_signal_id,
      c.origin_iso3,
      unnest(c.affected_iso3) AS target_iso3,
      c.domain,
      c.signal_type,
      c.intensity,
      c.intensity_semantics,
      p.id AS prediction_id,
      p.risk_probability AS origin_value,
      p.probability_semantics AS origin_semantics,
      p.source_snapshot_date
    FROM public.cross_border_signals c
    JOIN latest_eligible p
      ON p.country_iso3 = c.origin_iso3
     AND p.domain = c.domain
    WHERE c.detected_at > now() - interval '90 days'
      AND c.intensity IS NOT NULL
      AND c.intensity >= 0
      AND c.intensity <= 1
      AND c.intensity_semantics IS NOT NULL
      AND btrim(c.intensity_semantics) <> ''
      AND lower(c.intensity_semantics) NOT LIKE '%legacy%'
      AND lower(c.intensity_semantics) NOT LIKE '%unknown%'
      AND lower(c.intensity_semantics) NOT LIKE '%unverified%'
      AND lower(c.intensity_semantics) NOT LIKE '%unlabeled%'
      AND lower(c.intensity_semantics) NOT LIKE '%withheld%'
      AND lower(c.intensity_semantics) NOT LIKE '%not_quantified%'
  )
  INSERT INTO public.risk_propagation_score (
    origin_iso3,
    target_iso3,
    domain,
    propagation_score,
    contagion_path,
    hop_count,
    generation_batch_id,
    evidence_status,
    propagation_semantics,
    origin_input_semantics,
    edge_intensity_semantics,
    source_prediction_id,
    source_cross_border_signal_id,
    source_snapshot_date
  )
  SELECT
    e.origin_iso3,
    e.target_iso3,
    e.domain,
    LEAST(1, GREATEST(0, e.origin_value * e.intensity)),
    jsonb_build_array(
      jsonb_build_object(
        'iso3', e.origin_iso3,
        'role', 'origin',
        'input_value', e.origin_value,
        'input_semantics', e.origin_semantics
      ),
      jsonb_build_object(
        'iso3', e.target_iso3,
        'role', 'direct_exposure_target',
        'signal_type', e.signal_type,
        'edge_intensity', e.intensity,
        'edge_intensity_semantics', e.intensity_semantics
      )
    ),
    1,
    v_batch,
    'sufficient_for_deterministic_screen',
    'deterministic_origin_value_times_quantified_edge_intensity_not_probability',
    e.origin_semantics,
    e.intensity_semantics,
    e.prediction_id,
    e.cross_border_signal_id,
    e.source_snapshot_date
  FROM eligible_edges e
  WHERE e.target_iso3 IS NOT NULL
    AND e.target_iso3 <> e.origin_iso3;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_batch, v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_risk_propagation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_risk_propagation() TO service_role;

COMMENT ON COLUMN public.cross_border_signals.intensity IS
  'Nullable quantified cross-border transmission/exposure intensity in [0,1] only when intensity_semantics establishes its meaning. Unknown intensity is NULL.';
COMMENT ON COLUMN public.risk_propagation_score.propagation_score IS
  'Deterministic product screen for prioritizing possible exposure pathways. It is not a probability or calibrated causal estimate.';
COMMENT ON COLUMN public.risk_propagation_score.propagation_semantics IS
  'Declares the analytical meaning of propagation_score. New v2 rows use deterministic_origin_value_times_quantified_edge_intensity_not_probability.';
COMMENT ON TABLE public.risk_propagation_abstentions IS
  'Append-only evidence showing why AICIS withheld a propagation screen instead of substituting a missing model input or edge intensity.';