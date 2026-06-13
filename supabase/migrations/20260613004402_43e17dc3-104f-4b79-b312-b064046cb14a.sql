-- Phase C trust drain: backfill publisher_key on existing citations by matching source_name to registry.
-- Many older signal-derived citations were inserted with publisher_key NULL even though the source_name
-- (e.g. 'bbc.com', 'cdc.gov') exactly matches a registered authority publisher_key. That collapses them
-- into the 'other' tier (weight 0.05) and crushes official_source_pct in the trust score.
-- This migration adds a function + supporting indexes to backfill in safe 25k-row chunks, plus a cron job.

CREATE INDEX IF NOT EXISTS idx_intel_citations_source_name_lower
  ON public.intelligence_citations (lower(source_name))
  WHERE publisher_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_authority_registry_pk_lower
  ON public.source_authority_registry (lower(publisher_key));

CREATE OR REPLACE FUNCTION public.phase_c_backfill_citation_publisher_keys(p_batch int DEFAULT 25000)
RETURNS TABLE(updated int, remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_remaining bigint := 0;
BEGIN
  WITH candidate AS (
    SELECT c.id, r.publisher_key, r.default_confidence_weight, r.authority_tier
    FROM public.intelligence_citations c
    JOIN public.source_authority_registry r
      ON lower(c.source_name) = lower(r.publisher_key)
    WHERE c.publisher_key IS NULL
      AND c.source_name IS NOT NULL
    LIMIT p_batch
  ),
  upd AS (
    UPDATE public.intelligence_citations c
       SET publisher_key      = cand.publisher_key,
           confidence_weight  = GREATEST(coalesce(c.confidence_weight, 0), cand.default_confidence_weight),
           source_type        = CASE WHEN cand.authority_tier = 1 THEN 'official' ELSE c.source_type END
      FROM candidate cand
     WHERE c.id = cand.id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  SELECT count(*) INTO v_remaining
    FROM public.intelligence_citations c
    JOIN public.source_authority_registry r ON lower(c.source_name) = lower(r.publisher_key)
   WHERE c.publisher_key IS NULL AND c.source_name IS NOT NULL;

  RETURN QUERY SELECT v_updated, v_remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION public.phase_c_backfill_citation_publisher_keys(int) TO authenticated, service_role;