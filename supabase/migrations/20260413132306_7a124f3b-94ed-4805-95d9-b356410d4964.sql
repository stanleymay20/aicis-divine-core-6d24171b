
-- 1. Snapshot table for pre-aggregated stats
CREATE TABLE IF NOT EXISTS public.planetary_stats_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapped_at timestamptz NOT NULL DEFAULT now(),
  metrics_total bigint NOT NULL DEFAULT 0,
  entities_total bigint NOT NULL DEFAULT 0,
  metric_links bigint NOT NULL DEFAULT 0,
  event_links bigint NOT NULL DEFAULT 0,
  entity_links bigint NOT NULL DEFAULT 0,
  provenance_sources bigint NOT NULL DEFAULT 0,
  reporting_countries int NOT NULL DEFAULT 0,
  coverage_countries int NOT NULL DEFAULT 0,
  metrics_country_coverage int NOT NULL DEFAULT 0,
  link_to_metric_pct numeric(6,2) NOT NULL DEFAULT 0,
  provenance_pct numeric(6,2) NOT NULL DEFAULT 0,
  provenance_completeness_pct numeric(6,2) NOT NULL DEFAULT 0,
  duplicate_rate_pct numeric(6,2) NOT NULL DEFAULT 0,
  canonical_mismatches int NOT NULL DEFAULT 0,
  job_offsets jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE public.planetary_stats_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view snapshots"
  ON public.planetary_stats_snapshots FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_stats_snapshots_time ON public.planetary_stats_snapshots (snapped_at DESC);

-- 2. Snapshot function (lightweight, scheduled)
CREATE OR REPLACE FUNCTION public.snap_planetary_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_metrics bigint;
  v_entities bigint;
  v_ml bigint;
  v_el bigint;
  v_entl bigint;
  v_prov bigint;
  v_rc int;
  v_cc int;
  v_mcc int;
  v_link_pct numeric;
  v_prov_pct numeric;
  v_prov_complete numeric;
  v_dup_rate numeric;
  v_mismatches int;
  v_offsets jsonb;
BEGIN
  SELECT COUNT(*) INTO v_metrics FROM normalized_metrics;
  SELECT COUNT(*) INTO v_entities FROM canonical_entities;
  SELECT COUNT(*) INTO v_ml FROM entity_metric_links;
  SELECT COUNT(*) INTO v_el FROM entity_event_links;
  SELECT COUNT(*) INTO v_entl FROM entity_links;
  SELECT COUNT(DISTINCT provenance_source) INTO v_prov FROM normalized_metrics WHERE provenance_source IS NOT NULL;

  SELECT COUNT(*) INTO v_rc FROM canonical_entities
    WHERE entity_type::text IN ('country','territory') AND sovereignty_status IN ('sovereign_state','territory','disputed');
  SELECT COUNT(*) INTO v_cc FROM canonical_entities
    WHERE entity_type::text IN ('country','territory') AND sovereignty_status != 'deprecated';
  SELECT COUNT(DISTINCT iso3) INTO v_mcc FROM normalized_metrics WHERE iso3 IS NOT NULL;

  v_link_pct := CASE WHEN v_metrics > 0 THEN ROUND(v_ml::numeric / v_metrics * 100, 2) ELSE 0 END;
  v_prov_pct := CASE WHEN v_metrics > 0 THEN ROUND((SELECT COUNT(*) FROM normalized_metrics WHERE provenance_source IS NOT NULL)::numeric / v_metrics * 100, 2) ELSE 0 END;

  -- Provenance completeness: % of metrics with ALL six fields populated
  SELECT CASE WHEN v_metrics > 0 THEN ROUND(
    COUNT(*) FILTER (WHERE
      provider_name IS NOT NULL
      AND provenance_source IS NOT NULL
      AND retrieved_at IS NOT NULL
      AND freshness_score IS NOT NULL
    )::numeric / v_metrics * 100, 2
  ) ELSE 0 END
  INTO v_prov_complete FROM normalized_metrics;

  -- Duplicate rate
  SELECT CASE WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) - COUNT(DISTINCT dedup_key))::numeric / COUNT(*) * 100, 2)
    ELSE 0 END
  INTO v_dup_rate FROM normalized_metrics WHERE dedup_key IS NOT NULL;

  -- Canonical mismatches: source ISO3s in metrics not mapped to any canonical entity
  SELECT COUNT(DISTINCT nm.iso3) INTO v_mismatches
  FROM normalized_metrics nm
  WHERE nm.iso3 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM canonical_entities ce
      WHERE ce.iso3 = nm.iso3
        AND ce.entity_type::text IN ('country','territory')
    );

  -- Job offsets as JSON
  SELECT jsonb_object_agg(key, value_int) INTO v_offsets FROM backfill_state;

  INSERT INTO planetary_stats_snapshots (
    metrics_total, entities_total, metric_links, event_links, entity_links,
    provenance_sources, reporting_countries, coverage_countries, metrics_country_coverage,
    link_to_metric_pct, provenance_pct, provenance_completeness_pct,
    duplicate_rate_pct, canonical_mismatches, job_offsets
  ) VALUES (
    v_metrics, v_entities, v_ml, v_el, v_entl,
    v_prov, v_rc, v_cc, v_mcc,
    v_link_pct, v_prov_pct, v_prov_complete,
    v_dup_rate, v_mismatches, COALESCE(v_offsets, '{}')
  );
END;
$$;

-- 3. Canonical mismatch audit view
CREATE OR REPLACE VIEW public.canonical_mismatch_audit AS
WITH duplicate_iso3 AS (
  SELECT iso3, COUNT(*) AS entity_count
  FROM canonical_entities
  WHERE entity_type::text IN ('country','territory') AND iso3 IS NOT NULL
  GROUP BY iso3 HAVING COUNT(*) > 1
),
data_no_links AS (
  SELECT ce.iso3, ce.canonical_name
  FROM canonical_entities ce
  WHERE ce.entity_type::text IN ('country','territory')
    AND ce.sovereignty_status IN ('sovereign_state','territory','disputed')
    AND EXISTS (SELECT 1 FROM normalized_metrics nm WHERE nm.iso3 = ce.iso3)
    AND NOT EXISTS (
      SELECT 1 FROM entity_metric_links eml WHERE eml.entity_id = ce.id
    )
),
coverage_not_reporting AS (
  SELECT ce.iso3, ce.canonical_name, ce.sovereignty_status::text
  FROM canonical_entities ce
  WHERE ce.entity_type::text IN ('country','territory')
    AND ce.sovereignty_status NOT IN ('sovereign_state','territory','disputed')
    AND ce.sovereignty_status != 'deprecated'
    AND EXISTS (SELECT 1 FROM normalized_metrics nm WHERE nm.iso3 = ce.iso3)
),
unmapped_source_codes AS (
  SELECT DISTINCT nm.iso3 AS source_iso3
  FROM normalized_metrics nm
  WHERE nm.iso3 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM canonical_entities ce
      WHERE ce.iso3 = nm.iso3 AND ce.entity_type::text IN ('country','territory')
    )
)
SELECT 'duplicate_iso3' AS issue_type, iso3 AS code, entity_count::text AS detail FROM duplicate_iso3
UNION ALL
SELECT 'data_no_links', iso3, canonical_name FROM data_no_links
UNION ALL
SELECT 'coverage_not_reporting', iso3, canonical_name || ' (' || sovereignty_status || ')' FROM coverage_not_reporting
UNION ALL
SELECT 'unmapped_source_code', source_iso3, 'metrics exist but no canonical entity' FROM unmapped_source_codes
ORDER BY issue_type, code;

ALTER VIEW public.canonical_mismatch_audit SET (security_invoker = true);

-- 4. Update milestone audit to include new checks
CREATE OR REPLACE FUNCTION public.run_milestone_audit(_milestone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_metrics bigint;
  v_entities bigint;
  v_metric_links bigint;
  v_entity_links bigint;
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

  SELECT CASE WHEN v_metrics > 0
    THEN ROUND(COUNT(*) FILTER (WHERE provenance_source IS NOT NULL)::numeric / v_metrics * 100, 2)
    ELSE 0 END INTO v_provenance_pct FROM normalized_metrics;

  SELECT CASE WHEN v_metrics > 0 THEN ROUND(
    COUNT(*) FILTER (WHERE provider_name IS NOT NULL AND provenance_source IS NOT NULL AND retrieved_at IS NOT NULL AND freshness_score IS NOT NULL)::numeric / v_metrics * 100, 2
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

  v_checks := jsonb_build_object(
    'milestone',v_milestone,'metrics_total',v_metrics,'entities_total',v_entities,
    'metric_links',v_metric_links,'entity_links',v_entity_links,
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
$$;
