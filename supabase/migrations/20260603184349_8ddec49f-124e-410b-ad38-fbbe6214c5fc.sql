
-- Phase B extension: global_signals citation backfill
-- Each global_signal is its own primary evidence; we mint one intelligence_citations row per signal,
-- prioritized by (P1) high confidence × high impact, (P2) signals already linked to early warnings,
-- (P3) signals linked to recommendations, (P4) everything else.
-- Idempotent via NOT EXISTS guard on (subject_type='global_signals', subject_id=signal.id).

CREATE INDEX IF NOT EXISTS idx_global_signals_priority_backfill
  ON public.global_signals (confidence_score DESC NULLS LAST, impact_score DESC NULLS LAST, ingested_at DESC)
  WHERE primary_source IS NOT NULL;

CREATE OR REPLACE FUNCTION public.phase_b_backfill_signal_citations(
  p_priority text DEFAULT 'high_value',  -- 'high_value' | 'warning_linked' | 'rec_linked' | 'archive'
  p_batch integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_priority = 'high_value' THEN
    WITH cand AS (
      SELECT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.confidence_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND coalesce(gs.confidence_score, 0) >= 70
        AND coalesce(gs.impact_score, 0) >= 60
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_citations c
          WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id
        )
      ORDER BY gs.confidence_score DESC NULLS LAST, gs.impact_score DESC NULLS LAST, gs.ingested_at DESC
      LIMIT p_batch
    ),
    ins AS (
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
      FROM cand
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;

  ELSIF p_priority = 'warning_linked' THEN
    WITH cand AS (
      SELECT DISTINCT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      JOIN aicis_early_warnings w ON gs.affected_countries @> ARRAY[w.iso3]
        AND gs.latest_update_at >= w.first_detected_at - interval '7 days'
        AND gs.latest_update_at <= w.first_detected_at + interval '1 day'
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_citations c
          WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id
        )
      ORDER BY gs.ingested_at DESC
      LIMIT p_batch
    ),
    ins AS (
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
      FROM cand
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;

  ELSIF p_priority = 'rec_linked' THEN
    WITH cand AS (
      SELECT DISTINCT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      JOIN risk_action_recommendations r ON gs.affected_countries @> ARRAY[r.country_iso3]
        AND gs.latest_update_at >= r.generated_at - interval '14 days'
        AND gs.latest_update_at <= r.generated_at + interval '1 day'
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_citations c
          WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id
        )
      ORDER BY gs.ingested_at DESC
      LIMIT p_batch
    ),
    ins AS (
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
      FROM cand
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;

  ELSIF p_priority = 'archive' THEN
    WITH cand AS (
      SELECT gs.id, gs.primary_source, gs.canonical_source_name, gs.official_source,
             gs.source_credibility_score, gs.ingested_at, gs.created_at,
             gs.normalized_summary, gs.summary, gs.title
      FROM global_signals gs
      WHERE gs.primary_source IS NOT NULL
        AND gs.canonical_source_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_citations c
          WHERE c.subject_type = 'global_signals' AND c.subject_id = gs.id
        )
      ORDER BY gs.ingested_at DESC
      LIMIT p_batch
    ),
    ins AS (
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
      FROM cand
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
  END IF;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.phase_b_backfill_signal_citations(text, integer) TO service_role;

-- Extend phase_b_progress view with signal-citation tracks
DROP VIEW IF EXISTS public.phase_b_progress;
CREATE VIEW public.phase_b_progress
WITH (security_invoker = true) AS
SELECT 'entity_identifiers'::text AS track,
       (SELECT count(*) FROM entity_identifiers) AS rows,
       NULL::numeric AS pct_complete
UNION ALL
SELECT 'kg_links_adjacency',
       (SELECT count(*) FROM entity_links WHERE source = 'adjacency_v3'),
       round(100.0 * (SELECT count(*) FROM entity_links WHERE source = 'adjacency_v3')::numeric
             / NULLIF((SELECT count(*) FROM adjacency_v3), 0)::numeric, 2)
UNION ALL
SELECT 'citations_warnings',
       (SELECT count(*) FROM intelligence_citations WHERE subject_type='aicis_early_warnings'),
       round(100.0 * (SELECT count(*) FROM intelligence_citations WHERE subject_type='aicis_early_warnings')::numeric
             / NULLIF((SELECT count(*) FROM aicis_early_warnings), 0)::numeric, 2)
UNION ALL
SELECT 'citations_recommendations',
       (SELECT count(*) FROM intelligence_citations WHERE subject_type='risk_action_recommendations'),
       round(100.0 * (SELECT count(*) FROM intelligence_citations WHERE subject_type='risk_action_recommendations')::numeric
             / NULLIF((SELECT count(*) FROM risk_action_recommendations), 0)::numeric, 2)
UNION ALL
SELECT 'citations_signals',
       (SELECT count(*) FROM intelligence_citations WHERE subject_type='global_signals'),
       round(100.0 * (SELECT count(*) FROM intelligence_citations WHERE subject_type='global_signals')::numeric
             / NULLIF((SELECT count(*) FROM global_signals WHERE primary_source IS NOT NULL), 0)::numeric, 2)
UNION ALL
SELECT 'ledger_crisis_chained',
       (SELECT count(*) FROM ledger_entries WHERE entry_type::text='crisis'),
       round(100.0 * (SELECT count(*) FROM ledger_entries WHERE entry_type::text='crisis')::numeric
             / NULLIF((SELECT count(*) FROM aicis_early_warnings), 0)::numeric, 2)
UNION ALL
SELECT 'ledger_recommendation_chained',
       (SELECT count(*) FROM ledger_entries WHERE entry_type::text='recommendation'),
       round(100.0 * (SELECT count(*) FROM ledger_entries WHERE entry_type::text='recommendation')::numeric
             / NULLIF((SELECT count(*) FROM risk_action_recommendations), 0)::numeric, 2)
UNION ALL
SELECT 'ledger_prediction_chained',
       (SELECT count(*) FROM ledger_entries WHERE entry_type::text='prediction'),
       round(100.0 * (SELECT count(*) FROM ledger_entries WHERE entry_type::text='prediction')::numeric
             / NULLIF((SELECT count(*) FROM risk_ranking_predictions), 0)::numeric, 2);

GRANT SELECT ON public.phase_b_progress TO anon, authenticated;
