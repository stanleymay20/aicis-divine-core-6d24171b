CREATE OR REPLACE FUNCTION public.f_force_missing_snapshots()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE missing_count int; gap_isos text[];
BEGIN
  -- Report coverage gaps honestly; never insert placeholder snapshot rows.
  SELECT array_agg(ccl.iso3), COUNT(*) INTO gap_isos, missing_count
  FROM canonical_country_list ccl
  WHERE ccl.entity_type='country'
    AND NOT EXISTS (SELECT 1 FROM country_performance_snapshots s
      WHERE s.iso3 = ccl.iso3 AND s.created_at > now() - interval '7 days');
  RETURN jsonb_build_object('missing', missing_count, 'gap_isos', gap_isos, 'placeholders_inserted', 0, 'run_at', now());
END;
$function$;