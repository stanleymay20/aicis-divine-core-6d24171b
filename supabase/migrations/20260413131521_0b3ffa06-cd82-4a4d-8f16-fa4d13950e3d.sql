
-- 1. Operator status view: all 13 metrics in one query
CREATE OR REPLACE VIEW public.planetary_scale_status AS
SELECT
  (SELECT COUNT(*) FROM normalized_metrics) AS metrics_total,
  (SELECT COUNT(*) FROM canonical_entities) AS entities_total,
  (SELECT COUNT(*) FROM entity_metric_links) AS metric_links_total,
  (SELECT COUNT(*) FROM entity_event_links) AS event_links_total,
  (SELECT COUNT(*) FROM entity_links) AS entity_links_total,
  (SELECT COUNT(DISTINCT provenance_source) FROM normalized_metrics WHERE provenance_source IS NOT NULL) AS provenance_sources,
  (SELECT COUNT(DISTINCT iso3) FROM canonical_entities WHERE entity_type::text IN ('country','territory') AND sovereignty_status IN ('sovereign_state','territory','disputed')) AS reporting_countries,
  (SELECT COUNT(DISTINCT iso3) FROM canonical_entities WHERE entity_type::text IN ('country','territory') AND sovereignty_status != 'deprecated') AS coverage_countries,
  (SELECT COUNT(DISTINCT iso3) FROM normalized_metrics WHERE iso3 IS NOT NULL) AS metrics_country_coverage,
  CASE WHEN (SELECT COUNT(*) FROM normalized_metrics) > 0
    THEN ROUND((SELECT COUNT(*) FROM entity_metric_links)::numeric / (SELECT COUNT(*) FROM normalized_metrics) * 100, 2)
    ELSE 0
  END AS link_to_metric_pct,
  CASE WHEN (SELECT COUNT(*) FROM normalized_metrics) > 0
    THEN ROUND((SELECT COUNT(*) FROM normalized_metrics WHERE provenance_source IS NOT NULL)::numeric / (SELECT COUNT(*) FROM normalized_metrics) * 100, 2)
    ELSE 0
  END AS provenance_to_metric_pct;

-- 2. Per-job offset tracker
CREATE OR REPLACE VIEW public.planetary_job_offsets AS
SELECT key AS job_key, value_int AS current_offset, updated_at AS last_tick
FROM backfill_state
ORDER BY key;

-- 3. Per-job cron health (last 24h)
CREATE OR REPLACE VIEW public.planetary_cron_health AS
SELECT
  job_name,
  COUNT(*) AS total_runs,
  COUNT(*) FILTER (WHERE status = 'success') AS success_count,
  COUNT(*) FILTER (WHERE status = 'error') AS error_count,
  COUNT(*) FILTER (WHERE status = 'timeout') AS timeout_count,
  COUNT(*) FILTER (WHERE status = 'running') AS still_running,
  MAX(executed_at) AS last_run_at,
  ROUND(AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END) * 100, 1) AS success_rate_pct
FROM automation_logs
WHERE executed_at >= now() - interval '24 hours'
GROUP BY job_name
ORDER BY job_name;

-- 4. Duplicate/conflict rate estimation
CREATE OR REPLACE VIEW public.planetary_duplicate_rate AS
WITH dedup_stats AS (
  SELECT
    provider_name,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT dedup_key) AS unique_keys
  FROM normalized_metrics
  WHERE dedup_key IS NOT NULL
  GROUP BY provider_name
)
SELECT
  provider_name,
  total_rows,
  unique_keys,
  total_rows - unique_keys AS estimated_conflicts,
  CASE WHEN total_rows > 0
    THEN ROUND((total_rows - unique_keys)::numeric / total_rows * 100, 2)
    ELSE 0
  END AS conflict_rate_pct
FROM dedup_stats
ORDER BY total_rows DESC;

-- 5. Country coverage integrity
CREATE OR REPLACE VIEW public.planetary_country_integrity AS
SELECT
  ce.iso3,
  ce.canonical_name,
  ce.sovereignty_status::text,
  (SELECT COUNT(*) FROM normalized_metrics nm WHERE nm.iso3 = ce.iso3) AS metric_count,
  (SELECT COUNT(DISTINCT metric_name) FROM normalized_metrics nm WHERE nm.iso3 = ce.iso3) AS distinct_metrics,
  (SELECT COUNT(*) FROM entity_metric_links eml
   JOIN canonical_entities ce2 ON ce2.id = eml.entity_id
   WHERE ce2.iso3 = ce.iso3) AS link_count,
  CASE WHEN (SELECT COUNT(*) FROM normalized_metrics nm WHERE nm.iso3 = ce.iso3) = 0
    THEN 'NO_DATA' ELSE 'HAS_DATA'
  END AS data_status
FROM canonical_entities ce
WHERE ce.entity_type::text IN ('country','territory')
  AND ce.sovereignty_status IN ('sovereign_state','territory','disputed')
ORDER BY ce.iso3;

-- 6. Milestone audit log table
CREATE TABLE IF NOT EXISTS public.milestone_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone text NOT NULL,
  metrics_at_audit bigint NOT NULL,
  passed boolean NOT NULL,
  checks jsonb NOT NULL,
  audited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.milestone_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view milestone audits"
  ON public.milestone_audit_log FOR SELECT TO authenticated USING (true);

-- 7. Milestone audit function
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
  v_link_ratio numeric;
  v_dup_rate numeric;
  v_countries_with_data int;
  v_countries_total int;
  v_failed_crons int;
  v_zombie_jobs int;
  v_milestone text;
  v_checks jsonb;
  v_all_pass boolean := true;
  v_check_results jsonb := '[]'::jsonb;
BEGIN
  -- Gather counts
  SELECT COUNT(*) INTO v_metrics FROM normalized_metrics;
  SELECT COUNT(*) INTO v_entities FROM canonical_entities;
  SELECT COUNT(*) INTO v_metric_links FROM entity_metric_links;
  SELECT COUNT(*) INTO v_entity_links FROM entity_links;

  -- Provenance coverage
  SELECT CASE WHEN v_metrics > 0
    THEN ROUND((COUNT(*) FILTER (WHERE provenance_source IS NOT NULL))::numeric / v_metrics * 100, 2)
    ELSE 0 END
  INTO v_provenance_pct FROM normalized_metrics;

  -- Link ratio
  v_link_ratio := CASE WHEN v_metrics > 0 THEN ROUND(v_metric_links::numeric / v_metrics * 100, 2) ELSE 0 END;

  -- Duplicate rate (global)
  SELECT CASE WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) - COUNT(DISTINCT dedup_key))::numeric / COUNT(*) * 100, 2)
    ELSE 0 END
  INTO v_dup_rate FROM normalized_metrics WHERE dedup_key IS NOT NULL;

  -- Country coverage
  SELECT COUNT(DISTINCT iso3) INTO v_countries_with_data FROM normalized_metrics WHERE iso3 IS NOT NULL;
  SELECT COUNT(*) INTO v_countries_total FROM canonical_entities
    WHERE entity_type::text IN ('country','territory')
      AND sovereignty_status IN ('sovereign_state','territory','disputed');

  -- Failed crons in last 6h
  SELECT COUNT(*) INTO v_failed_crons FROM automation_logs
    WHERE status = 'error' AND executed_at >= now() - interval '6 hours';

  -- Zombie jobs
  SELECT COUNT(*) INTO v_zombie_jobs FROM automation_logs
    WHERE status = 'running' AND executed_at < now() - interval '1 hour';

  -- Determine milestone
  v_milestone := COALESCE(_milestone,
    CASE
      WHEN v_metrics >= 10000000 THEN '10M'
      WHEN v_metrics >= 8000000 THEN '8M'
      WHEN v_metrics >= 5000000 THEN '5M'
      WHEN v_metrics >= 2000000 THEN '2M'
      ELSE 'pre-2M'
    END
  );

  -- CHECK 1: No runaway duplication (< 5%)
  v_check_results := v_check_results || jsonb_build_object(
    'check', 'duplicate_rate',
    'value', v_dup_rate,
    'threshold', 5.0,
    'passed', v_dup_rate < 5.0,
    'detail', 'Duplicate rate: ' || v_dup_rate || '%'
  );
  IF v_dup_rate >= 5.0 THEN v_all_pass := false; END IF;

  -- CHECK 2: Country mapping integrity (>= 80% of canonical countries have data)
  v_check_results := v_check_results || jsonb_build_object(
    'check', 'country_coverage',
    'value', v_countries_with_data,
    'total', v_countries_total,
    'coverage_pct', CASE WHEN v_countries_total > 0 THEN ROUND(v_countries_with_data::numeric / v_countries_total * 100, 1) ELSE 0 END,
    'passed', v_countries_with_data::numeric / GREATEST(v_countries_total, 1) >= 0.8,
    'detail', v_countries_with_data || '/' || v_countries_total || ' countries have metrics'
  );
  IF v_countries_with_data::numeric / GREATEST(v_countries_total, 1) < 0.8 THEN v_all_pass := false; END IF;

  -- CHECK 3: Links growing proportionally (link ratio >= 1%)
  v_check_results := v_check_results || jsonb_build_object(
    'check', 'link_proportionality',
    'link_ratio_pct', v_link_ratio,
    'metric_links', v_metric_links,
    'entity_links', v_entity_links,
    'passed', v_link_ratio >= 1.0,
    'detail', 'Link-to-metric ratio: ' || v_link_ratio || '%'
  );
  IF v_link_ratio < 1.0 THEN v_all_pass := false; END IF;

  -- CHECK 4: Provenance keeping pace (>= 90%)
  v_check_results := v_check_results || jsonb_build_object(
    'check', 'provenance_coverage',
    'provenance_pct', v_provenance_pct,
    'passed', v_provenance_pct >= 90.0,
    'detail', 'Provenance coverage: ' || v_provenance_pct || '%'
  );
  IF v_provenance_pct < 90.0 THEN v_all_pass := false; END IF;

  -- CHECK 5: Cron health (< 10 failures in 6h, no zombies)
  v_check_results := v_check_results || jsonb_build_object(
    'check', 'cron_health',
    'failed_6h', v_failed_crons,
    'zombie_jobs', v_zombie_jobs,
    'passed', v_failed_crons < 10 AND v_zombie_jobs = 0,
    'detail', v_failed_crons || ' failures (6h), ' || v_zombie_jobs || ' zombie jobs'
  );
  IF v_failed_crons >= 10 OR v_zombie_jobs > 0 THEN v_all_pass := false; END IF;

  v_checks := jsonb_build_object(
    'milestone', v_milestone,
    'metrics_total', v_metrics,
    'entities_total', v_entities,
    'metric_links', v_metric_links,
    'entity_links', v_entity_links,
    'countries_with_data', v_countries_with_data,
    'countries_total', v_countries_total,
    'provenance_pct', v_provenance_pct,
    'link_ratio_pct', v_link_ratio,
    'duplicate_rate_pct', v_dup_rate,
    'failed_crons_6h', v_failed_crons,
    'zombie_jobs', v_zombie_jobs,
    'all_passed', v_all_pass,
    'checks', v_check_results,
    'audited_at', now()
  );

  -- Log milestone audit
  INSERT INTO milestone_audit_log (milestone, metrics_at_audit, passed, checks)
  VALUES (v_milestone, v_metrics, v_all_pass, v_checks);

  RETURN v_checks;
END;
$$;
