-- LRIL truth-floor hardening v1
-- Missing evidence must remain unknown. Do not manufacture confidence, geo quality,
-- source reliability, event time, or severity merely because the pipeline expects a number.

ALTER TABLE public.aicis_raw_local_signals
  ALTER COLUMN source_reliability DROP DEFAULT;

ALTER TABLE public.aicis_geo_entities
  ALTER COLUMN geo_confidence DROP DEFAULT;

ALTER TABLE public.aicis_local_events
  ALTER COLUMN severity DROP DEFAULT,
  ALTER COLUMN confidence DROP DEFAULT;

ALTER TABLE public.aicis_local_events
  ADD COLUMN IF NOT EXISTS epistemic_status TEXT,
  ADD COLUMN IF NOT EXISTS confidence_semantics TEXT,
  ADD COLUMN IF NOT EXISTS severity_semantics TEXT,
  ADD COLUMN IF NOT EXISTS event_time_status TEXT;

-- Existing rows predate this truth-floor contract and must not be silently reclassified
-- as measured merely because numerical values are present.
UPDATE public.aicis_local_events
SET
  epistemic_status = COALESCE(epistemic_status, 'legacy_unverified'),
  confidence_semantics = COALESCE(confidence_semantics, 'legacy_score_semantics_unverified'),
  severity_semantics = COALESCE(severity_semantics, 'legacy_score_semantics_unverified'),
  event_time_status = COALESCE(event_time_status, 'legacy_timestamp_semantics_unverified')
WHERE epistemic_status IS NULL
   OR confidence_semantics IS NULL
   OR severity_semantics IS NULL
   OR event_time_status IS NULL;

COMMENT ON COLUMN public.aicis_local_events.epistemic_status IS
  'Truth-floor status of the event representation. Unknown evidence must not be converted to synthetic certainty.';
COMMENT ON COLUMN public.aicis_local_events.confidence_semantics IS
  'Meaning/provenance of confidence. NULL confidence means insufficient governed evidence.';
COMMENT ON COLUMN public.aicis_local_events.severity_semantics IS
  'Meaning/provenance of severity, including whether it is rule-derived rather than measured.';
COMMENT ON COLUMN public.aicis_local_events.event_time_status IS
  'Whether start_time is provider-supplied/observed or legacy-unverified. Missing provider time must not be converted to now.';

DROP FUNCTION IF EXISTS public.lril_compute_confidence(integer, numeric, numeric, numeric, numeric, numeric, integer);

CREATE OR REPLACE FUNCTION public.lril_compute_confidence(
  p_source_count integer,
  p_avg_source_reliability numeric,
  p_keyword_strength numeric,
  p_geo_confidence numeric,
  p_temporal_density numeric,
  p_proxy_boost numeric DEFAULT 0,
  p_fatality_count integer DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  src_score numeric;
  base numeric;
BEGIN
  -- Truth floor: these are required inputs to this score. Their absence is not
  -- evidence for a midpoint, minimum floor, or prior probability.
  IF p_source_count IS NULL
     OR p_source_count < 1
     OR p_avg_source_reliability IS NULL
     OR p_keyword_strength IS NULL
     OR p_geo_confidence IS NULL
     OR p_temporal_density IS NULL THEN
    RETURN NULL;
  END IF;

  src_score := LEAST(1.0, 0.40 + 0.25 * ln(GREATEST(p_source_count, 1)));

  base := 0.30 * src_score
        + 0.25 * GREATEST(0, LEAST(1, p_avg_source_reliability))
        + 0.25 * GREATEST(0, p_keyword_strength)
        + 0.15 * GREATEST(0, LEAST(1, p_geo_confidence))
        + 0.05 * GREATEST(0, LEAST(1, p_temporal_density))
        + LEAST(0.2, GREATEST(0, COALESCE(p_proxy_boost, 0)));

  -- These are deterministic scoring rules, not calibrated probabilities.
  IF p_keyword_strength >= 1.0 THEN base := GREATEST(base, 0.42); END IF;
  IF p_source_count >= 1 AND p_avg_source_reliability >= 0.85 AND p_keyword_strength >= 1.0 THEN
    base := GREATEST(base, 0.50);
  END IF;
  IF p_source_count >= 2 THEN base := GREATEST(base, 0.50); END IF;
  IF p_source_count >= 3 AND p_avg_source_reliability >= 0.6 THEN base := GREATEST(base, 0.70); END IF;
  IF COALESCE(p_fatality_count, 0) >= 3 AND p_geo_confidence >= 0.5 THEN base := GREATEST(base, 0.55); END IF;
  IF COALESCE(p_fatality_count, 0) >= 10 THEN base := GREATEST(base, 0.70); END IF;

  RETURN LEAST(1.0, ROUND(base::numeric, 4));
END;
$fn$;

COMMENT ON FUNCTION public.lril_compute_confidence(integer, numeric, numeric, numeric, numeric, numeric, integer) IS
  'Deterministic LRIL heuristic score. Returns NULL when required evidence is missing. Not a calibrated probability.';

-- Preserve the existing bridge contract, but make the truth requirement explicit:
-- only non-null scores that satisfy the deterministic threshold may bridge.
CREATE OR REPLACE FUNCTION public.lril_bridge_to_normalized()
RETURNS TABLE(bridged_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count INT := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.normalized_events (
      provider_name, event_type, category, title, description,
      country_iso3, iso3, severity, confidence,
      occurred_at, started_at, source_name, source_url, raw_data, dedup_key
    )
    SELECT
      'lril', le.event_type, le.event_type,
      coalesce(le.title, le.subtype || ' in ' || coalesce(le.locality, le.iso3_normalized, le.iso3)),
      le.description,
      coalesce(le.iso3_normalized, le.iso3),
      coalesce(le.iso3_normalized, le.iso3),
      CASE WHEN le.severity IS NULL THEN NULL ELSE (le.severity * 10)::int END,
      le.confidence,
      le.start_time,
      le.start_time,
      'AICIS LRIL',
      NULL,
      jsonb_build_object(
        'lril_event_id', le.id,
        'subtype', le.subtype,
        'locality', le.locality,
        'admin_level_1', le.admin_level_1,
        'source_count', le.source_count,
        'matched_keywords', le.matched_keywords,
        'lat', le.lat,
        'lon', le.lon,
        'confidence_tier', le.confidence_tier,
        'confidence_semantics', le.confidence_semantics,
        'severity_semantics', le.severity_semantics,
        'epistemic_status', le.epistemic_status,
        'event_time_status', le.event_time_status,
        'iso3_raw', le.iso3,
        'iso3_normalized', le.iso3_normalized
      ),
      'lril_' || le.id::text
    FROM public.aicis_local_events le
    WHERE le.bridged_to_normalized = FALSE
      AND le.confidence IS NOT NULL
      AND le.confidence >= 0.35
      AND le.status = 'active'
      AND coalesce(le.iso3_normalized, le.iso3) IS NOT NULL
      AND le.event_time_status = 'provider_supplied'
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  UPDATE public.aicis_local_events
  SET bridged_to_normalized = TRUE
  WHERE bridged_to_normalized = FALSE
    AND confidence IS NOT NULL
    AND confidence >= 0.35
    AND status = 'active'
    AND coalesce(iso3_normalized, iso3) IS NOT NULL
    AND event_time_status = 'provider_supplied';

  RETURN QUERY SELECT v_count;
END;
$fn$;

COMMENT ON FUNCTION public.lril_bridge_to_normalized() IS
  'Bridges only LRIL events with non-null heuristic confidence and provider-supplied event time; unknown evidence remains withheld.';

INSERT INTO public.audit_log (action, resource_type, resource_id, severity, metadata)
VALUES (
  'lril-truth-floor-v1',
  'epistemic-hardening',
  'lril',
  'info',
  jsonb_build_object(
    'source_reliability_default_removed', true,
    'geo_confidence_default_removed', true,
    'event_severity_default_removed', true,
    'event_confidence_default_removed', true,
    'confidence_missing_evidence_behavior', 'null',
    'bridge_requires_provider_time', true,
    'confidence_semantics', 'deterministic_heuristic_not_calibrated_probability'
  )
);