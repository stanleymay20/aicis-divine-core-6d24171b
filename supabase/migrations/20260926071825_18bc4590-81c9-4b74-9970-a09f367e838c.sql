CREATE OR REPLACE FUNCTION public.phase_b_backfill_signal_citations(p_priority text DEFAULT 'high_value'::text, p_batch integer DEFAULT 500)
 RETURNS integer LANGUAGE plpgsql SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_cand_filter text; v_count integer := 0;
BEGIN
  IF p_priority = 'high_value' THEN
    v_cand_filter := $f$
      SELECT id, primary_source, canonical_source_name, official_source, source_credibility_score, ingested_at, created_at, normalized_summary, summary, title
      FROM global_signals WHERE primary_source IS NOT NULL AND canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c WHERE c.subject_type='global_signals' AND c.subject_id=global_signals.id)
      ORDER BY coalesce(source_credibility_score, 0) DESC, latest_update_at DESC LIMIT $1 $f$;
  ELSIF p_priority = 'recent' THEN
    v_cand_filter := $f$
      SELECT id, primary_source, canonical_source_name, official_source, source_credibility_score, ingested_at, created_at, normalized_summary, summary, title
      FROM global_signals WHERE primary_source IS NOT NULL AND canonical_source_name IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intelligence_citations c WHERE c.subject_type='global_signals' AND c.subject_id=global_signals.id)
      ORDER BY latest_update_at DESC LIMIT $1 $f$;
  ELSE RETURN 0; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _phase_b_cand (id uuid, primary_source text, canonical_source_name text, official_source boolean,
    source_credibility_score numeric, ingested_at timestamptz, created_at timestamptz, normalized_summary text, summary text, title text) ON COMMIT DROP;
  TRUNCATE _phase_b_cand;
  EXECUTE 'INSERT INTO _phase_b_cand ' || v_cand_filter USING p_batch;

  INSERT INTO publisher_intake_queue (publisher_key, publisher_name, sample_source_url, observation_count, last_seen_at)
  SELECT lower(canonical_source_name), max(canonical_source_name), max(primary_source), count(*), now()
  FROM _phase_b_cand
  WHERE canonical_source_name IS NOT NULL
    AND lower(canonical_source_name) NOT IN (SELECT publisher_key FROM source_authority_registry)
  GROUP BY lower(canonical_source_name)
  ON CONFLICT (publisher_key) DO UPDATE
    SET observation_count = publisher_intake_queue.observation_count + EXCLUDED.observation_count,
        last_seen_at = now(),
        sample_source_url = COALESCE(publisher_intake_queue.sample_source_url, EXCLUDED.sample_source_url);

  WITH ins AS (
    INSERT INTO intelligence_citations (subject_type, subject_id, publisher_key, source_name, source_url, source_type, confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
    SELECT 'global_signals', id,
           (SELECT publisher_key FROM source_authority_registry WHERE publisher_key = lower(canonical_source_name)),
           coalesce(canonical_source_name, primary_source, 'unknown'), primary_source,
           CASE WHEN official_source THEN 'official' ELSE 'media' END,
           coalesce(source_credibility_score::numeric / 100.0, 0.5),
           coalesce(ingested_at, created_at, now()),
           encode(extensions.digest(coalesce(primary_source,'')||id::text,'sha256'),'hex'),
           encode(extensions.digest(coalesce(canonical_source_name,'')||id::text,'sha256'),'hex')
    FROM _phase_b_cand RETURNING 1)
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END $function$;