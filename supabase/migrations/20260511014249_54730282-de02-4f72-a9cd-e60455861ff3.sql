
-- Helper index to make the join fast and chunked (partial index on the backlog).
CREATE INDEX IF NOT EXISTS idx_norm_metrics_null_entity_iso3
  ON public.normalized_metrics (id) WHERE entity_id IS NULL AND iso3 IS NOT NULL;

-- Batched setter — updates up to _batch rows per call, returns rows updated.
CREATE OR REPLACE FUNCTION public.backfill_metric_entity_iso3(_batch int DEFAULT 50000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count int;
BEGIN
  WITH cte AS (
    SELECT nm.id, ce.id AS entity_id
    FROM public.normalized_metrics nm
    JOIN public.canonical_entities ce
      ON ce.iso3 = nm.iso3
     AND ce.entity_type IN ('country','territory')
    WHERE nm.entity_id IS NULL
      AND nm.iso3 IS NOT NULL
    LIMIT _batch
  )
  UPDATE public.normalized_metrics nm
  SET entity_id = cte.entity_id
  FROM cte
  WHERE nm.id = cte.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Schedule: every 2 minutes, drain 50k rows. Backlog clears in ~2h.
SELECT cron.schedule(
  'backfill-metric-entity-iso3-2min',
  '*/2 * * * *',
  $$ SELECT public.backfill_metric_entity_iso3(50000); $$
);
