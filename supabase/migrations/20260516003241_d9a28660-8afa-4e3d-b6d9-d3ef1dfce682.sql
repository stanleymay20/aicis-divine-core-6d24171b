
CREATE OR REPLACE FUNCTION public.compute_source_iq_scorecard(p_source text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total bigint; v_with_value bigint; v_with_iso3 bigint; v_recent bigint; v_dupes bigint;
  v_completeness numeric; v_accuracy numeric; v_consistency numeric;
  v_timeliness numeric; v_validity numeric; v_uniqueness numeric;
  v_id uuid;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE value IS NOT NULL),
         COUNT(*) FILTER (WHERE iso3 IS NOT NULL AND length(iso3)=3),
         COUNT(*) FILTER (
           WHERE provenance_observed_at IS NOT NULL
             AND provenance_observed_at > now() - interval '30 days'
         )
    INTO v_total, v_with_value, v_with_iso3, v_recent
  FROM public.normalized_metrics WHERE provider_name = p_source;

  IF v_total IS NULL OR v_total = 0 THEN RETURN NULL; END IF;

  SELECT v_total - COUNT(DISTINCT (iso3, metric_name, period))
    INTO v_dupes FROM public.normalized_metrics WHERE provider_name = p_source;

  v_completeness := round((v_with_value::numeric / v_total) * 100, 2);
  v_validity     := round((v_with_iso3::numeric / v_total) * 100, 2);
  v_timeliness   := round((v_recent::numeric / v_total) * 100, 2);
  v_uniqueness   := round(((v_total - GREATEST(v_dupes,0))::numeric / v_total) * 100, 2);
  v_accuracy     := LEAST(100, v_validity * 0.7 + v_completeness * 0.3);
  v_consistency  := LEAST(100, (v_validity + v_completeness) / 2);

  INSERT INTO public.source_iq_scorecards(
    source_name, completeness, accuracy, consistency, timeliness, validity, uniqueness, rows_assessed
  ) VALUES (
    p_source, v_completeness, v_accuracy, v_consistency, v_timeliness, v_validity, v_uniqueness, v_total
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
