CREATE OR REPLACE FUNCTION public.phase_b_backfill_signal_citations(p_priority text DEFAULT 'high_value'::text, p_batch integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count integer := 0;
  v_cand_filter text;
  v_sql text;
BEGIN
  -- Build candidate filter for each priority track
  IF p_priority = 'high_value' THEN
    v_cand_filter := $f$
      SELECT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND coalesce(gs.confidence_score, 0) >= 70
        AND coalesce(gs.impact_score, 0) >= 60
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id)
      ORDER BY gs.confidence_score DESC NULLS LAST, gs.impact_score DESC NULLS LAST, gs.ingested_at DESC
      LIMIT $1
    $f$;
  ELSIF p_priority = 'warning_linked' THEN
    v_cand_filter := $f$
      SELECT DISTINCT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      JOIN aicis_early_warnings w ON gs.affected_countries @> ARRAY[w.iso3]
        AND gs.latest_update_at >= w.first_detected_at - interval '7 days'
        AND gs.latest_update_at <= w.first_detected_at + interval '1 day'
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id)
      ORDER BY gs.ingested_at DESC
      LIMIT $1
    $f$;
  ELSIF p_priority = 'rec_linked' THEN
    v_cand_filter := $f$
      SELECT DISTINCT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      JOIN risk_action_recommendations r ON gs.affected_countries @> ARRAY[r.country_iso3]
        AND gs.latest_update_at >= r.generated_at - interval '14 days'
        AND gs.latest_update_at <= r.generated_at + interval '1 day'
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id)
      ORDER BY gs.ingested_at DESC
      LIMIT $1
    $f$;
  ELSIF p_priority = 'archive' THEN
    v_cand_filter := $f$
      SELECT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id)
      ORDER BY gs.ingested_at DESC
      LIMIT $1
    $f$;
  ELSE
    RETURN 0;
  END IF;

  -- Materialize candidates
  CREATE TEMP TABLE IF NOT EXISTS _phase_b_cand (
    id uuid, primary_source text, canonical_source_name text, official_source boolean,
    source_credibility_score numeric, ingested_at timestamptz, created_at timestamptz,
    normalized_summary text, summary text, title text
  ) ON COMMIT DROP;
  TRUNCATE _phase_b_cand;
  EXECUTE 'INSERT INTO _phase_b_cand ' || v_cand_filter USING p_batch;

  -- Auto-seed missing publishers at media tier (tier 4). Never downgrade existing entries.
  INSERT INTO source_authority_registry
    (publisher_key, publisher_name, publisher_type, authority_tier, jurisdiction, base_url, default_confidence_weight)
  SELECT DISTINCT lower(canonical_source_name),
         canonical_source_name,
         'media',
         4,
         'GLOBAL',
         primary_source,
         0.4
  FROM _phase_b_cand
  WHERE canonical_source_name IS NOT NULL
  ON CONFLICT (publisher_key) DO NOTHING;

  -- Insert citations
  WITH ins AS (
    INSERT INTO intelligence_citations
      (subject_type, subject_id, publisher_key, source_name, source_url, source_type,
       confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
    SELECT 'global_signals', id,
           lower(canonical_source_name),
           coalesce(canonical_source_name, primary_source, 'unknown'),
           primary_source,
           CASE WHEN official_source THEN 'official' ELSE 'media' END,
           coalesce(source_credibility_score::numeric / 100.0, 0.5),
           coalesce(ingested_at, created_at, now()),
           encode(extensions.digest(coalesce(primary_source, '') || id::text, 'sha256'), 'hex'),
           encode(extensions.digest(coalesce(normalized_summary, summary, title, '') || id::text, 'sha256'), 'hex')
    FROM _phase_b_cand
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $function$;