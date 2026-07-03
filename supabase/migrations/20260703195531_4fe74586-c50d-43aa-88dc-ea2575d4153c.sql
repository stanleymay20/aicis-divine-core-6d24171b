
-- Sweep #16: Training pipeline modernization (retry with date-arith fix)

CREATE TABLE IF NOT EXISTS public.training_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id text UNIQUE NOT NULL,
  mode text NOT NULL DEFAULT 'incremental',
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','timeout','cancelled','partial')),
  window_start date,
  window_end date,
  horizon_days int NOT NULL DEFAULT 7,
  chunk_size_days int NOT NULL DEFAULT 1,
  total_chunks int,
  chunks_completed int NOT NULL DEFAULT 0,
  records_processed int NOT NULL DEFAULT 0,
  last_watermark date,
  last_country_iso3 text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms bigint,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_training_executions_status
  ON public.training_executions (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_executions_started
  ON public.training_executions (started_at DESC);

GRANT SELECT ON public.training_executions TO authenticated;
GRANT ALL ON public.training_executions TO service_role;
ALTER TABLE public.training_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and operators view training executions" ON public.training_executions;
CREATE POLICY "Admins and operators view training executions"
  ON public.training_executions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

DROP POLICY IF EXISTS "Service role manages training executions" ON public.training_executions;
CREATE POLICY "Service role manages training executions"
  ON public.training_executions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.training_dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version text UNIQUE NOT NULL,
  execution_id text REFERENCES public.training_executions(execution_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  window_start date NOT NULL,
  window_end date NOT NULL,
  horizon_days int NOT NULL DEFAULT 7,
  row_count int NOT NULL DEFAULT 0,
  feature_count int NOT NULL DEFAULT 0,
  positive_rate numeric,
  checksum text,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_current boolean NOT NULL DEFAULT false,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_training_dataset_versions_created
  ON public.training_dataset_versions (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_dataset_versions_current
  ON public.training_dataset_versions (is_current) WHERE is_current = true;

GRANT SELECT ON public.training_dataset_versions TO authenticated;
GRANT ALL ON public.training_dataset_versions TO service_role;
ALTER TABLE public.training_dataset_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and operators view dataset versions" ON public.training_dataset_versions;
CREATE POLICY "Admins and operators view dataset versions"
  ON public.training_dataset_versions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

DROP POLICY IF EXISTS "Service role manages dataset versions" ON public.training_dataset_versions;
CREATE POLICY "Service role manages dataset versions"
  ON public.training_dataset_versions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.training_dataset_watermark(p_horizon int DEFAULT 7)
RETURNS TABLE(latest_snapshot date, latest_built_at timestamptz, row_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT MAX(snapshot_date)::date, MAX(built_at), COUNT(*)::bigint
  FROM public.training_dataset_aicis WHERE horizon_days = p_horizon;
$$;
GRANT EXECUTE ON FUNCTION public.training_dataset_watermark(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.training_dataset_missing_days(
  p_lookback_days int DEFAULT 14, p_horizon int DEFAULT 7
) RETURNS TABLE(snapshot_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH span AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_lookback_days || ' days')::interval)::date,
      (CURRENT_DATE - (p_horizon || ' days')::interval)::date,
      INTERVAL '1 day'
    )::date AS d
  ),
  present AS (
    SELECT DISTINCT snapshot_date
    FROM public.training_dataset_aicis
    WHERE horizon_days = p_horizon
      AND snapshot_date >= (CURRENT_DATE - (p_lookback_days || ' days')::interval)::date
  )
  SELECT s.d FROM span s
  LEFT JOIN present p ON p.snapshot_date = s.d
  WHERE p.snapshot_date IS NULL
  ORDER BY s.d;
$$;
GRANT EXECUTE ON FUNCTION public.training_dataset_missing_days(int,int) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.training_freshness AS
WITH ds AS (
  SELECT MAX(snapshot_date) AS latest_snapshot,
         MAX(built_at) AS latest_built_at,
         COUNT(*) AS total_rows,
         COUNT(*) FILTER (WHERE built_at > now() - interval '24 hours') AS rows_last_24h,
         COUNT(*) FILTER (WHERE built_at > now() - interval '7 days')  AS rows_last_7d
  FROM public.training_dataset_aicis WHERE horizon_days = 7
),
last_ver AS (
  SELECT dataset_version, created_at, row_count, window_start, window_end
  FROM public.training_dataset_versions ORDER BY created_at DESC LIMIT 1
),
last_exec AS (
  SELECT execution_id, status, mode, started_at, completed_at, records_processed,
         chunks_completed, total_chunks, failure_reason
  FROM public.training_executions ORDER BY started_at DESC LIMIT 1
),
last_ok AS (
  SELECT started_at, completed_at FROM public.training_executions
  WHERE status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1
)
SELECT
  ds.latest_snapshot, ds.latest_built_at, ds.total_rows, ds.rows_last_24h, ds.rows_last_7d,
  EXTRACT(EPOCH FROM (now() - ds.latest_built_at)) / 3600.0 AS hours_since_last_build,
  (CURRENT_DATE - ds.latest_snapshot)::numeric AS days_snapshot_lag,
  lv.dataset_version    AS latest_version,
  lv.created_at         AS latest_version_at,
  lv.row_count          AS latest_version_rows,
  lv.window_start       AS latest_version_window_start,
  lv.window_end         AS latest_version_window_end,
  le.execution_id       AS last_execution_id,
  le.status             AS last_execution_status,
  le.mode               AS last_execution_mode,
  le.started_at         AS last_execution_started_at,
  le.completed_at       AS last_execution_completed_at,
  le.records_processed  AS last_execution_records,
  le.chunks_completed   AS last_execution_chunks_completed,
  le.total_chunks       AS last_execution_total_chunks,
  le.failure_reason     AS last_execution_failure_reason,
  lo.completed_at       AS last_successful_completion,
  CASE
    WHEN ds.latest_built_at IS NULL THEN 'never'
    WHEN ds.latest_built_at > now() - interval '30 hours' THEN 'fresh'
    WHEN ds.latest_built_at > now() - interval '72 hours' THEN 'aging'
    ELSE 'stale'
  END AS freshness_status
FROM ds LEFT JOIN last_ver lv ON true LEFT JOIN last_exec le ON true LEFT JOIN last_ok lo ON true;

GRANT SELECT ON public.training_freshness TO authenticated, service_role;
