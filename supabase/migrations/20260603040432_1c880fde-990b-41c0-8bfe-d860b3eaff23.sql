-- GIN index for affected_countries lookups (used by citation backfill lateral join)
CREATE INDEX IF NOT EXISTS idx_global_signals_affected_countries_gin
  ON public.global_signals USING gin (affected_countries);

-- One-time publisher seed (so backfill function doesn't re-scan 632K signals each call)
INSERT INTO public.source_authority_registry
  (publisher_key, publisher_name, publisher_type, authority_tier, default_confidence_weight)
SELECT DISTINCT lower(canonical_source_name),
       coalesce(canonical_source_name, 'Unknown publisher'),
       'media', 4, 0.4
FROM public.global_signals
WHERE canonical_source_name IS NOT NULL
ON CONFLICT (publisher_key) DO NOTHING;

-- Strip the per-call publisher upsert (now redundant)
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
        WHERE gs.affected_countries @> ARRAY[c.iso3]
          AND gs.primary_source IS NOT NULL
          AND gs.canonical_source_name IS NOT NULL
          AND gs.latest_update_at >= c.first_detected_at - interval '7 days'
        ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC
        LIMIT 1
      ) g ON true
    ),
    ins AS (
      INSERT INTO intelligence_citations
        (subject_type, subject_id, publisher_key, source_name, source_url, source_type,
         confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
      SELECT 'aicis_early_warnings', sid,
             lower(canonical_source_name),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'),
             primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(extensions.digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(extensions.digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
      FROM matched
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;

  ELSIF p_subject_type = 'risk_action_recommendations' THEN
    WITH cand AS (
      SELECT r.id, r.country_iso3, r.generated_at
      FROM risk_action_recommendations r
      WHERE NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type='risk_action_recommendations' AND c.subject_id=r.id)
      ORDER BY r.generated_at DESC
      LIMIT p_batch
    ),
    matched AS (
      SELECT c.id AS sid, g.*
      FROM cand c
      JOIN LATERAL (
        SELECT * FROM global_signals gs
        WHERE gs.affected_countries @> ARRAY[c.country_iso3]
          AND gs.primary_source IS NOT NULL
          AND gs.canonical_source_name IS NOT NULL
          AND gs.latest_update_at BETWEEN c.generated_at - interval '14 days' AND c.generated_at + interval '1 day'
        ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC
        LIMIT 1
      ) g ON true
    ),
    ins AS (
      INSERT INTO intelligence_citations
        (subject_type, subject_id, publisher_key, source_name, source_url, source_type,
         confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
      SELECT 'risk_action_recommendations', sid,
             lower(canonical_source_name),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'),
             primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(extensions.digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(extensions.digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
      FROM matched
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
  END IF;
  RETURN v_count;
END $$;