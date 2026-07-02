CREATE OR REPLACE FUNCTION public.compute_cross_domain_influence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '180s'
AS $function$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_inserted int := 0;
BEGIN
  INSERT INTO public.cross_domain_influence (
    source_domain, target_domain, region, transfer_strength, sample_size, generation_batch_id
  )
  SELECT
    a.domain AS source_domain,
    b.domain AS target_domain,
    NULL::text AS region,
    LEAST(1.0, GREATEST(0.0, CORR(a.score, b.score))) AS transfer_strength,
    COUNT(*) AS sample_size,
    v_batch
  FROM public.risk_scores a
  JOIN public.risk_scores b
    ON a.country_iso3 = b.country_iso3
    AND a.computed_at = b.computed_at
    AND a.domain <> b.domain
  WHERE a.computed_at > now() - INTERVAL '7 days'
    AND b.computed_at > now() - INTERVAL '7 days'
  GROUP BY a.domain, b.domain
  HAVING COUNT(*) >= 30 AND CORR(a.score, b.score) IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES ('compute_cross_domain_influence', 'success',
    format('Inserted %s rows (batch %s)', v_inserted, v_batch));

  RETURN jsonb_build_object('batch_id', v_batch, 'rows_inserted', v_inserted);
END;
$function$;