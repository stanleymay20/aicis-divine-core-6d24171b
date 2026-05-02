
-- ============================================================
-- SPRINT α — TRUTH FLOOR
-- Local→National accumulation integrity instrumentation
-- ============================================================

-- 1. SUBNATIONAL INFERENCE RUNS LEDGER -----------------------
CREATE TABLE IF NOT EXISTS public.subnational_inference_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  admin_level smallint,
  country_iso3 text,
  rows_written integer NOT NULL DEFAULT 0,
  rows_attempted integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','succeeded','partial','failed','zero_write')),
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subnat_runs_func_time
  ON public.subnational_inference_runs(function_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_subnat_runs_status_time
  ON public.subnational_inference_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_subnat_runs_country
  ON public.subnational_inference_runs(country_iso3, started_at DESC);

ALTER TABLE public.subnational_inference_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subnat_runs_admin_read" ON public.subnational_inference_runs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "subnat_runs_service_insert" ON public.subnational_inference_runs
  FOR INSERT TO authenticated WITH CHECK (false);  -- service role only

-- 2. DENORMALIZED country_iso3 ON village_indicators & regional_insights -----
ALTER TABLE public.village_indicators
  ADD COLUMN IF NOT EXISTS country_iso3 text;
ALTER TABLE public.regional_insights
  ADD COLUMN IF NOT EXISTS primary_country_iso3 text;

UPDATE public.village_indicators vi
SET country_iso3 = ar.country_iso3
FROM public.admin_regions ar
WHERE ar.id = vi.region_id
  AND vi.country_iso3 IS NULL
  AND ar.country_iso3 IS NOT NULL;

UPDATE public.regional_insights ri
SET primary_country_iso3 = (ri.countries_included)[1]
WHERE ri.primary_country_iso3 IS NULL
  AND array_length(ri.countries_included, 1) >= 1;

CREATE INDEX IF NOT EXISTS idx_village_indicators_country
  ON public.village_indicators(country_iso3, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_village_indicators_country_domain
  ON public.village_indicators(country_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_regional_insights_primary_country
  ON public.regional_insights(primary_country_iso3, computed_at DESC);

-- Trigger: keep village_indicators.country_iso3 in sync on insert/update
CREATE OR REPLACE FUNCTION public.tg_village_sync_country_iso3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.country_iso3 IS NULL AND NEW.region_id IS NOT NULL THEN
    SELECT country_iso3 INTO NEW.country_iso3
    FROM public.admin_regions WHERE id = NEW.region_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_village_sync_country_iso3 ON public.village_indicators;
CREATE TRIGGER trg_village_sync_country_iso3
  BEFORE INSERT OR UPDATE OF region_id ON public.village_indicators
  FOR EACH ROW EXECUTE FUNCTION public.tg_village_sync_country_iso3();

-- 3. SEED ATTEMPT RETRY MACHINERY ------------------------------
ALTER TABLE public.village_seed_attempts
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Initialize next_retry_at for existing zero-result rows so the daily job picks them up
UPDATE public.village_seed_attempts
SET next_retry_at = COALESCE(next_retry_at, now())
WHERE villages_found = 0 AND next_retry_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_seed_attempts_retry_due
  ON public.village_seed_attempts(next_retry_at)
  WHERE villages_found = 0;

-- Helper: schedule next retry with exponential backoff (max 7 days)
CREATE OR REPLACE FUNCTION public.schedule_village_seed_retry(_iso3 text, _success boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _next_count int;
  _backoff interval;
BEGIN
  SELECT COALESCE(MAX(retry_count),0) + 1 INTO _next_count
  FROM public.village_seed_attempts WHERE country_iso3 = _iso3;

  -- 1h, 2h, 4h, 8h, 16h, 32h, 64h, capped at 7d
  _backoff := LEAST(make_interval(hours => POWER(2, LEAST(_next_count, 7))::int), interval '7 days');

  UPDATE public.village_seed_attempts
  SET retry_count = _next_count,
      next_retry_at = CASE WHEN _success THEN NULL ELSE now() + _backoff END,
      last_error = _error,
      updated_at = now()
  WHERE country_iso3 = _iso3;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.schedule_village_seed_retry(text,boolean,text) FROM anon, authenticated;

-- 4. DATA QUALITY VIEWS (security_invoker for RBAC) -------------
CREATE OR REPLACE VIEW public.dq_village_layer_health
WITH (security_invoker = true) AS
SELECT
  ar.country_iso3,
  COUNT(DISTINCT vi.region_id) AS regions_with_data,
  COUNT(*) AS village_rows,
  COUNT(*) FILTER (WHERE vi.observed_at > now() - interval '24 hours') AS rows_24h,
  COUNT(*) FILTER (WHERE vi.observed_at > now() - interval '7 days')  AS rows_7d,
  MAX(vi.observed_at) AS last_observed_at,
  EXTRACT(EPOCH FROM (now() - MAX(vi.observed_at)))/3600.0 AS hours_since_last,
  CASE
    WHEN MAX(vi.observed_at) IS NULL THEN 'never'
    WHEN MAX(vi.observed_at) > now() - interval '24 hours' THEN 'fresh'
    WHEN MAX(vi.observed_at) > now() - interval '7 days'  THEN 'aging'
    ELSE 'stale'
  END AS freshness_status
FROM public.admin_regions ar
LEFT JOIN public.village_indicators vi ON vi.region_id = ar.id
WHERE ar.country_iso3 IS NOT NULL
GROUP BY ar.country_iso3;

CREATE OR REPLACE VIEW public.dq_orphan_regions
WITH (security_invoker = true) AS
SELECT
  admin_level,
  COUNT(*) FILTER (WHERE country_iso3 IS NULL) AS missing_iso3,
  COUNT(*) FILTER (WHERE parent_id IS NULL AND admin_level >= 1) AS missing_parent,
  COUNT(*) FILTER (WHERE lat IS NULL OR lon IS NULL) AS missing_centroid,
  COUNT(*) FILTER (WHERE population_est IS NULL) AS missing_population
FROM public.admin_regions
GROUP BY admin_level
ORDER BY admin_level;

CREATE OR REPLACE VIEW public.dq_inference_run_health
WITH (security_invoker = true) AS
WITH recent AS (
  SELECT function_name,
         COUNT(*) AS runs_24h,
         COUNT(*) FILTER (WHERE status='succeeded') AS ok_24h,
         COUNT(*) FILTER (WHERE status='zero_write') AS zero_24h,
         COUNT(*) FILTER (WHERE status='failed') AS failed_24h,
         SUM(rows_written) AS rows_written_24h,
         MAX(started_at) AS last_run_at
  FROM public.subnational_inference_runs
  WHERE started_at > now() - interval '24 hours'
  GROUP BY function_name
),
streaks AS (
  SELECT function_name,
         BOOL_AND(status IN ('zero_write','failed')) AS three_consec_zero
  FROM (
    SELECT function_name, status,
           ROW_NUMBER() OVER (PARTITION BY function_name ORDER BY started_at DESC) AS rn
    FROM public.subnational_inference_runs
  ) s
  WHERE rn <= 3
  GROUP BY function_name
)
SELECT r.*, COALESCE(s.three_consec_zero, false) AS three_consecutive_failures
FROM recent r
LEFT JOIN streaks s USING (function_name);

CREATE OR REPLACE VIEW public.dq_seed_retry_status
WITH (security_invoker = true) AS
SELECT
  country_iso3,
  MAX(villages_found) AS best_villages_found,
  MAX(retry_count) AS retry_count,
  MAX(attempted_at) AS last_attempt_at,
  MIN(next_retry_at) AS next_retry_at,
  MAX(last_error) AS last_error,
  CASE
    WHEN MAX(villages_found) > 0 THEN 'seeded'
    WHEN MIN(next_retry_at) IS NULL THEN 'abandoned'
    WHEN MIN(next_retry_at) <= now() THEN 'due'
    ELSE 'scheduled'
  END AS retry_state
FROM public.village_seed_attempts
GROUP BY country_iso3;

-- 5. STALE-FLAG HELPER for rollups ------------------------------
CREATE OR REPLACE FUNCTION public.country_l0_is_stale(_iso3 text, _max_hours int DEFAULT 168)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (now() - MAX(observed_at)) > make_interval(hours => _max_hours),
    true
  )
  FROM public.village_indicators
  WHERE country_iso3 = _iso3;
$fn$;
