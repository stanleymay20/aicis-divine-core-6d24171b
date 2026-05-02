-- v18: Atomic claim function for parallel lril-process workers using SKIP LOCKED
CREATE OR REPLACE FUNCTION public.lril_claim_signals(p_limit int DEFAULT 500)
RETURNS TABLE(
  id uuid,
  raw_text text,
  language text,
  country_hint text,
  region_hint text,
  source_reliability numeric,
  published_at timestamptz,
  url text,
  source_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT s.id
    FROM public.aicis_raw_local_signals s
    WHERE s.processed_at IS NULL
      AND s.claimed_at IS NULL
    ORDER BY s.published_at DESC NULLS LAST
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.aicis_raw_local_signals s
       SET claimed_at = now()
      FROM claimed c
     WHERE s.id = c.id
    RETURNING s.id, s.raw_text, s.language, s.country_hint, s.region_hint,
              s.source_reliability, s.published_at, s.url, s.source_name
  )
  SELECT * FROM upd;
END;
$$;

-- Add claimed_at column for soft-claim tracking (allows reset of stuck claims)
ALTER TABLE public.aicis_raw_local_signals
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_lril_signals_claim
  ON public.aicis_raw_local_signals (processed_at, claimed_at, published_at DESC NULLS LAST)
  WHERE processed_at IS NULL;

-- Auto-release stale claims (>5 min) so failed workers don't strand rows
CREATE OR REPLACE FUNCTION public.lril_release_stale_claims(p_max_age_minutes int DEFAULT 5)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE released int;
BEGIN
  WITH r AS (
    UPDATE public.aicis_raw_local_signals
       SET claimed_at = NULL
     WHERE processed_at IS NULL
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - make_interval(mins => p_max_age_minutes)
    RETURNING 1
  )
  SELECT count(*) INTO released FROM r;
  RETURN released;
END;
$$;

-- Progress checkpoint table for parallel worker observability
CREATE TABLE IF NOT EXISTS public.lril_process_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text,
  processed_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  last_batch_duration_ms int,
  remaining_unprocessed int,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lril_process_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkpoints_admin_select" ON public.lril_process_checkpoints
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_lril_checkpoints_created
  ON public.lril_process_checkpoints (created_at DESC);