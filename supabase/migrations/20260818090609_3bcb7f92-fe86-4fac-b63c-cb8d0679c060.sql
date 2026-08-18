CREATE OR REPLACE FUNCTION public.seal_predictions_into_ledger(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_prev text;
  v_payload text;
  v_payload_hash text;
  v_chain text;
  v_count int := 0;
BEGIN
  SELECT COALESCE(chain_hash, 'genesis') INTO v_prev
    FROM public.prediction_ledger ORDER BY sequence_number DESC LIMIT 1;
  v_prev := COALESCE(v_prev, 'genesis');

  FOR r IN
    SELECT * FROM (
      SELECT m.id, 'risk_ml_predictions'::text AS src, m.country_iso3, m.domain, m.generated_at,
             m.horizon_days, COALESCE(m.calibrated_score, m.risk_probability) AS prob,
             m.prediction_interval_lower AS lo, m.prediction_interval_upper AS hi,
             m.model_version, COALESCE(m.feature_contributions, m.feature_snapshot, '{}'::jsonb) AS feats,
             'risk_ml_inference'::text AS method
      FROM public.risk_ml_predictions m
      WHERE m.country_iso3 IS NOT NULL AND m.horizon_days IS NOT NULL
        AND COALESCE(m.calibrated_score, m.risk_probability) IS NOT NULL
      UNION ALL
      SELECT p.id, 'risk_ranking_predictions', p.country_iso3, p.domain, p.generated_at,
             p.horizon_days, p.risk_probability, p.confidence_lower, p.confidence_upper,
             p.model_version, COALESCE(p.factors, '{}'::jsonb), 'risk_ranking_baseline'
      FROM public.risk_ranking_predictions p
      WHERE p.country_iso3 IS NOT NULL AND p.horizon_days IS NOT NULL
        AND p.risk_probability IS NOT NULL
    ) s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.prediction_ledger pl
      WHERE pl.source_table = s.src AND pl.source_row_id = s.id)
    ORDER BY s.generated_at ASC
    LIMIT p_limit
  LOOP
    v_payload := r.src || '|' || r.country_iso3 || '|' || COALESCE(r.domain,'') || '|'
      || r.generated_at::text || '|' || r.horizon_days::text || '|' || round(r.prob, 8)::text
      || '|' || COALESCE(r.model_version, 'unknown');
    v_payload_hash := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');
    v_chain := encode(sha256(convert_to(v_prev || v_payload_hash, 'UTF8')), 'hex');

    INSERT INTO public.prediction_ledger (
      ledger_key, predicted_at, source_table, source_row_id, subject_kind, subject_key,
      domain, horizon_days, target_date, predicted_probability, interval_lower, interval_upper,
      model_version, method, features, payload_hash, previous_hash, chain_hash, status)
    VALUES (
      r.src || ':' || r.id::text, r.generated_at, r.src, r.id,
      'country_domain', r.country_iso3 || '/' || COALESCE(r.domain, 'all'),
      r.domain, r.horizon_days,
      (r.generated_at + (r.horizon_days || ' days')::interval)::date,
      LEAST(1, GREATEST(0, round(r.prob, 8))), r.lo, r.hi,
      COALESCE(r.model_version, 'unknown'), r.method, r.feats,
      v_payload_hash, v_prev, v_chain, 'open')
    ON CONFLICT (ledger_key) DO NOTHING;

    IF FOUND THEN
      v_prev := v_chain;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sealed', v_count,
    'ledger_total', (SELECT count(*) FROM public.prediction_ledger),
    'unsealed_remaining', (
      SELECT count(*) FROM (
        SELECT m.id, 'risk_ml_predictions'::text AS src FROM public.risk_ml_predictions m
         WHERE m.country_iso3 IS NOT NULL AND m.horizon_days IS NOT NULL
           AND COALESCE(m.calibrated_score, m.risk_probability) IS NOT NULL
        UNION ALL
        SELECT p.id, 'risk_ranking_predictions' FROM public.risk_ranking_predictions p
         WHERE p.country_iso3 IS NOT NULL AND p.horizon_days IS NOT NULL
           AND p.risk_probability IS NOT NULL) s
      WHERE NOT EXISTS (SELECT 1 FROM public.prediction_ledger pl
        WHERE pl.source_table = s.src AND pl.source_row_id = s.id)));
END;
$$;

GRANT EXECUTE ON FUNCTION public.seal_predictions_into_ledger(integer) TO service_role;