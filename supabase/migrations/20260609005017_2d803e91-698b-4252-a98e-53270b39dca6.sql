
-- 1. Publisher intake queue (curation staging — NOT trusted)
CREATE TABLE IF NOT EXISTS public.publisher_intake_queue (
  publisher_key text PRIMARY KEY,
  publisher_name text,
  sample_source_url text,
  observation_count bigint NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  curated_into_tier int,
  curated_at timestamptz,
  notes text
);
GRANT SELECT ON public.publisher_intake_queue TO authenticated, anon;
GRANT ALL ON public.publisher_intake_queue TO service_role;
ALTER TABLE public.publisher_intake_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "piq_public_read" ON public.publisher_intake_queue FOR SELECT USING (true);
CREATE POLICY "piq_service_all" ON public.publisher_intake_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_piq_status ON public.publisher_intake_queue(status);
CREATE INDEX IF NOT EXISTS idx_piq_observation_count ON public.publisher_intake_queue(observation_count DESC);

-- 2. Drain auto-seeded Tier-4 media rows from the registry into the queue.
--    Heuristic: tier=4 AND publisher_type='media' AND inserted by the auto-seeder
--    (i.e. anything in the 15k bulk that wasn't part of the original curated 18 + manual promotions).
WITH drained AS (
  SELECT publisher_key, publisher_name
  FROM public.source_authority_registry
  WHERE authority_tier = 4 AND publisher_type = 'media'
)
INSERT INTO public.publisher_intake_queue
  (publisher_key, publisher_name, observation_count, status, notes)
SELECT
  publisher_key,
  publisher_name,
  1,
  'pending',
  'Migrated from source_authority_registry (auto-seeded Tier-4 cleanup)'
FROM drained
ON CONFLICT (publisher_key) DO NOTHING;

-- intelligence_citations.publisher_key has ON DELETE SET NULL → safe to delete.
DELETE FROM public.source_authority_registry
WHERE authority_tier = 4 AND publisher_type = 'media';

-- 3. Rewrite phase_b_backfill_citations: queue unknown publishers, never seed registry.
CREATE OR REPLACE FUNCTION public.phase_b_backfill_citations(
  p_subject_type text, p_batch integer DEFAULT 300
) RETURNS integer LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_count integer := 0;
BEGIN
  IF p_subject_type = 'aicis_early_warnings' THEN
    WITH cand AS (
      SELECT w.id, w.iso3, w.first_detected_at
      FROM aicis_early_warnings w
      WHERE NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type='aicis_early_warnings' AND c.subject_id=w.id)
      ORDER BY w.first_detected_at DESC
      LIMIT p_batch
    ),
    matched AS (
      SELECT c.id AS sid, g.*
      FROM cand c
      JOIN LATERAL (
        SELECT * FROM global_signals gs
        WHERE c.iso3 = ANY(gs.affected_countries)
          AND gs.primary_source IS NOT NULL
          AND gs.canonical_source_name IS NOT NULL
          AND gs.latest_update_at >= c.first_detected_at - interval '7 days'
        ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC
        LIMIT 1
      ) g ON true
    ),
    -- queue unknown publishers (do not seed registry)
    queued AS (
      INSERT INTO publisher_intake_queue (publisher_key, publisher_name, sample_source_url, observation_count, last_seen_at)
      SELECT lower(canonical_source_name), canonical_source_name, primary_source, 1, now()
      FROM matched
      WHERE canonical_source_name IS NOT NULL
        AND lower(canonical_source_name) NOT IN (SELECT publisher_key FROM source_authority_registry)
      ON CONFLICT (publisher_key) DO UPDATE
        SET observation_count = publisher_intake_queue.observation_count + 1,
            last_seen_at = now(),
            sample_source_url = COALESCE(publisher_intake_queue.sample_source_url, EXCLUDED.sample_source_url)
      RETURNING 1
    ),
    ins AS (
      INSERT INTO intelligence_citations
        (subject_type, subject_id, publisher_key, source_name, source_url, source_type,
         confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
      SELECT 'aicis_early_warnings', sid,
             (SELECT publisher_key FROM source_authority_registry WHERE publisher_key = lower(canonical_source_name)),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'),
             primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(extensions.digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(extensions.digest(coalesce(canonical_source_name,'')||sid::text,'sha256'),'hex')
      FROM matched
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
  END IF;
  RETURN v_count;
END $$;

-- 4. Rewrite phase_b_backfill_signal_citations the same way.
CREATE OR REPLACE FUNCTION public.phase_b_backfill_signal_citations(
  p_priority text DEFAULT 'high_value', p_batch integer DEFAULT 500
) RETURNS integer LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE
  v_cand_filter text;
  v_count integer := 0;
BEGIN
  IF p_priority = 'high_value' THEN
    v_cand_filter := $f$
      SELECT id, primary_source, canonical_source_name, official_source,
             source_credibility_score, ingested_at, created_at,
             normalized_summary, summary, title
      FROM global_signals
      WHERE primary_source IS NOT NULL
        AND canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type='global_signals' AND c.subject_id=global_signals.id)
      ORDER BY coalesce(source_credibility_score, 0) DESC, latest_update_at DESC
      LIMIT $1
    $f$;
  ELSIF p_priority = 'recent' THEN
    v_cand_filter := $f$
      SELECT id, primary_source, canonical_source_name, official_source,
             source_credibility_score, ingested_at, created_at,
             normalized_summary, summary, title
      FROM global_signals
      WHERE primary_source IS NOT NULL
        AND canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type='global_signals' AND c.subject_id=global_signals.id)
      ORDER BY latest_update_at DESC
      LIMIT $1
    $f$;
  ELSE
    RETURN 0;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _phase_b_cand (
    id uuid, primary_source text, canonical_source_name text, official_source boolean,
    source_credibility_score numeric, ingested_at timestamptz, created_at timestamptz,
    normalized_summary text, summary text, title text
  ) ON COMMIT DROP;
  TRUNCATE _phase_b_cand;
  EXECUTE 'INSERT INTO _phase_b_cand ' || v_cand_filter USING p_batch;

  -- Queue unknown publishers (do not seed registry).
  INSERT INTO publisher_intake_queue (publisher_key, publisher_name, sample_source_url, observation_count, last_seen_at)
  SELECT lower(canonical_source_name), canonical_source_name, max(primary_source), count(*), now()
  FROM _phase_b_cand
  WHERE canonical_source_name IS NOT NULL
    AND lower(canonical_source_name) NOT IN (SELECT publisher_key FROM source_authority_registry)
  GROUP BY lower(canonical_source_name), canonical_source_name
  ON CONFLICT (publisher_key) DO UPDATE
    SET observation_count = publisher_intake_queue.observation_count + EXCLUDED.observation_count,
        last_seen_at = now(),
        sample_source_url = COALESCE(publisher_intake_queue.sample_source_url, EXCLUDED.sample_source_url);

  WITH ins AS (
    INSERT INTO intelligence_citations
      (subject_type, subject_id, publisher_key, source_name, source_url, source_type,
       confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
    SELECT 'global_signals', id,
           (SELECT publisher_key FROM source_authority_registry WHERE publisher_key = lower(canonical_source_name)),
           coalesce(canonical_source_name, primary_source, 'unknown'),
           primary_source,
           CASE WHEN official_source THEN 'official' ELSE 'media' END,
           coalesce(source_credibility_score::numeric / 100.0, 0.5),
           coalesce(ingested_at, created_at, now()),
           encode(extensions.digest(coalesce(primary_source,'')||id::text,'sha256'),'hex'),
           encode(extensions.digest(coalesce(canonical_source_name,'')||id::text,'sha256'),'hex')
    FROM _phase_b_cand
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $$;
