
CREATE OR REPLACE FUNCTION public.run_milestone_audit(_milestone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_metrics bigint;
  v_entities bigint;
  v_metric_links bigint;
  v_entity_links bigint;
  v_event_links bigint;
  v_events bigint;
  v_provenance_pct numeric;
  v_prov_complete numeric;
  v_link_ratio numeric;
  v_dup_rate numeric;
  v_countries_with_data int;
  v_countries_total int;
  v_failed_crons int;
  v_zombie_jobs int;
  v_mismatches int;
  v_milestone text;
  v_all_pass boolean := true;
  v_check_results jsonb := '[]'::jsonb;
  v_checks jsonb;
BEGIN
  SELECT COUNT(*) INTO v_metrics FROM normalized_metrics;
  SELECT COUNT(*) INTO v_entities FROM canonical_entities;
  SELECT COUNT(*) INTO v_metric_links FROM entity_metric_links;
  SELECT COUNT(*) INTO v_entity_links FROM entity_links;
  SELECT COUNT(*) INTO v_events FROM normalized_events;
  SELECT COUNT(*) INTO v_event_links FROM entity_event_links;

  SELECT CASE WHEN v_metrics > 0
    THEN ROUND(COUNT(*) FILTER (WHERE provenance_source IS NOT NULL)::numeric / v_metrics * 100, 2)
    ELSE 0 END INTO v_provenance_pct FROM normalized_metrics;

  SELECT CASE WHEN v_metrics > 0 THEN ROUND(
    COUNT(*) FILTER (WHERE provider_name IS NOT NULL AND provenance_source IS NOT NULL AND last_verified_at IS NOT NULL AND freshness_score IS NOT NULL)::numeric / v_metrics * 100, 2
  ) ELSE 0 END INTO v_prov_complete FROM normalized_metrics;

  v_link_ratio := CASE WHEN v_metrics > 0 THEN ROUND(v_metric_links::numeric / v_metrics * 100, 2) ELSE 0 END;

  SELECT CASE WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) - COUNT(DISTINCT dedup_key))::numeric / COUNT(*) * 100, 2)
    ELSE 0 END INTO v_dup_rate FROM normalized_metrics WHERE dedup_key IS NOT NULL;

  SELECT COUNT(DISTINCT iso3) INTO v_countries_with_data FROM normalized_metrics WHERE iso3 IS NOT NULL;
  SELECT COUNT(*) INTO v_countries_total FROM canonical_entities
    WHERE entity_type::text IN ('country','territory') AND sovereignty_status IN ('sovereign_state','territory','disputed');

  SELECT COUNT(*) INTO v_failed_crons FROM automation_logs WHERE status = 'error' AND executed_at >= now() - interval '6 hours';
  SELECT COUNT(*) INTO v_zombie_jobs FROM automation_logs WHERE status = 'running' AND executed_at < now() - interval '1 hour';

  SELECT COUNT(DISTINCT nm.iso3) INTO v_mismatches FROM normalized_metrics nm
    WHERE nm.iso3 IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM canonical_entities ce WHERE ce.iso3 = nm.iso3 AND ce.entity_type::text IN ('country','territory')
    );

  v_milestone := COALESCE(_milestone,
    CASE WHEN v_metrics >= 10000000 THEN '10M' WHEN v_metrics >= 8000000 THEN '8M'
         WHEN v_metrics >= 5000000 THEN '5M' WHEN v_metrics >= 2000000 THEN '2M' ELSE 'pre-2M' END);

  -- CHECK 1: Duplication < 5%
  v_check_results := v_check_results || jsonb_build_object('check','duplicate_rate','value',v_dup_rate,'threshold',5.0,'passed',v_dup_rate<5.0,'detail','Duplicate rate: '||v_dup_rate||'%');
  IF v_dup_rate >= 5.0 THEN v_all_pass := false; END IF;

  -- CHECK 2: Country coverage >= 80%
  v_check_results := v_check_results || jsonb_build_object('check','country_coverage','value',v_countries_with_data,'total',v_countries_total,
    'coverage_pct',CASE WHEN v_countries_total>0 THEN ROUND(v_countries_with_data::numeric/v_countries_total*100,1) ELSE 0 END,
    'passed',v_countries_with_data::numeric/GREATEST(v_countries_total,1)>=0.8,'detail',v_countries_with_data||'/'||v_countries_total||' countries have metrics');
  IF v_countries_with_data::numeric/GREATEST(v_countries_total,1)<0.8 THEN v_all_pass:=false; END IF;

  -- CHECK 3: Link ratio >= 1%
  v_check_results := v_check_results || jsonb_build_object('check','link_proportionality','link_ratio_pct',v_link_ratio,'metric_links',v_metric_links,'entity_links',v_entity_links,
    'passed',v_link_ratio>=1.0,'detail','Link-to-metric ratio: '||v_link_ratio||'%');
  IF v_link_ratio<1.0 THEN v_all_pass:=false; END IF;

  -- CHECK 4: Provenance presence >= 90%
  v_check_results := v_check_results || jsonb_build_object('check','provenance_presence','provenance_pct',v_provenance_pct,
    'passed',v_provenance_pct>=90.0,'detail','Provenance presence: '||v_provenance_pct||'%');
  IF v_provenance_pct<90.0 THEN v_all_pass:=false; END IF;

  -- CHECK 5: Provenance completeness >= 70%
  v_check_results := v_check_results || jsonb_build_object('check','provenance_completeness','completeness_pct',v_prov_complete,
    'passed',v_prov_complete>=70.0,'detail','Provenance completeness (4-field): '||v_prov_complete||'%');
  IF v_prov_complete<70.0 THEN v_all_pass:=false; END IF;

  -- CHECK 6: Cron health
  v_check_results := v_check_results || jsonb_build_object('check','cron_health','failed_6h',v_failed_crons,'zombie_jobs',v_zombie_jobs,
    'passed',v_failed_crons<10 AND v_zombie_jobs=0,'detail',v_failed_crons||' failures (6h), '||v_zombie_jobs||' zombie jobs');
  IF v_failed_crons>=10 OR v_zombie_jobs>0 THEN v_all_pass:=false; END IF;

  -- CHECK 7: Canonical mismatches = 0
  v_check_results := v_check_results || jsonb_build_object('check','canonical_integrity','unmapped_iso3s',v_mismatches,
    'passed',v_mismatches=0,'detail',v_mismatches||' source ISO3 codes not mapped to canonical entities');
  IF v_mismatches>0 THEN v_all_pass:=false; END IF;

  -- CHECK 8: Event link coverage >= 50%
  v_check_results := v_check_results || jsonb_build_object('check','event_link_coverage',
    'event_links',v_event_links,'events',v_events,
    'coverage_pct',CASE WHEN v_events>0 THEN ROUND(v_event_links::numeric/v_events*100,1) ELSE 0 END,
    'passed',v_event_links::numeric/GREATEST(v_events,1)>=0.5,
    'detail',v_event_links||'/'||v_events||' events linked');

  v_checks := jsonb_build_object(
    'milestone',v_milestone,'metrics_total',v_metrics,'entities_total',v_entities,
    'metric_links',v_metric_links,'entity_links',v_entity_links,
    'event_links',v_event_links,'events_total',v_events,
    'countries_with_data',v_countries_with_data,'countries_total',v_countries_total,
    'provenance_pct',v_provenance_pct,'provenance_completeness_pct',v_prov_complete,
    'link_ratio_pct',v_link_ratio,'duplicate_rate_pct',v_dup_rate,
    'canonical_mismatches',v_mismatches,
    'failed_crons_6h',v_failed_crons,'zombie_jobs',v_zombie_jobs,
    'all_passed',v_all_pass,'checks',v_check_results,'audited_at',now()
  );

  INSERT INTO milestone_audit_log (milestone, metrics_at_audit, passed, checks)
  VALUES (v_milestone, v_metrics, v_all_pass, v_checks);

  RETURN v_checks;
END;
$function$;
