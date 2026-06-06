-- Phase B v3: simplified, fast recommendation citation backfill
-- Previous v2 timed out at 120s due to 4-tier LATERAL with adjacency join.
-- Strategy: 2 tiers only (country-match, then domain-category global fallback),
-- pre-pick best signal via DISTINCT ON, small batches.

CREATE OR REPLACE FUNCTION public.phase_b_backfill_recs_fast(p_batch int DEFAULT 300)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH domain_cats AS (
    SELECT * FROM (VALUES
      ('governance', ARRAY['geopolitical','legal_regulatory','elections']),
      ('security',   ARRAY['defense_conflict','social_unrest','cybersecurity','maritime_security']),
      ('finance',    ARRAY['economic','financial_markets','central_banking']),
      ('education',  ARRAY['social_unrest']),
      ('energy',     ARRAY['energy','infrastructure']),
      ('climate',    ARRAY['climate_disaster','water_hydrology']),
      ('health',     ARRAY['public_health']),
      ('food',       ARRAY['food_agriculture','supply_chain']),
      ('population', ARRAY['migration_displacement','social_unrest']),
      ('trade',      ARRAY['supply_chain','economic'])
    ) AS d(domain, cats)
  ),
  cand AS (
    SELECT r.id, r.country_iso3, r.domain
    FROM risk_action_recommendations r
    WHERE NOT EXISTS (
      SELECT 1 FROM intelligence_citations c
      WHERE c.subject_type='risk_action_recommendations' AND c.subject_id=r.id
    )
    ORDER BY r.id
    LIMIT p_batch
  ),
  tier1 AS (
    -- Best country-match signal (any time, indexed on affected_countries)
    SELECT DISTINCT ON (c.id)
      c.id AS sid,
      gs.canonical_source_name, gs.primary_source, gs.official_source,
      gs.source_credibility_score, gs.normalized_summary, gs.summary,
      gs.ingested_at, gs.created_at
    FROM cand c
    JOIN global_signals gs ON gs.affected_countries @> ARRAY[c.country_iso3]
    WHERE gs.canonical_source_name IS NOT NULL
    ORDER BY c.id, gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC
  ),
  tier2 AS (
    -- Domain-category global fallback for recs that got no tier1 hit
    SELECT DISTINCT ON (c.id)
      c.id AS sid,
      gs.canonical_source_name, gs.primary_source, gs.official_source,
      gs.source_credibility_score, gs.normalized_summary, gs.summary,
      gs.ingested_at, gs.created_at
    FROM cand c
    JOIN domain_cats dc ON dc.domain = c.domain
    JOIN global_signals gs ON gs.category::text = ANY(dc.cats)
    WHERE NOT EXISTS (SELECT 1 FROM tier1 t WHERE t.sid = c.id)
      AND gs.canonical_source_name IS NOT NULL
    ORDER BY c.id, gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC
  ),
  combined AS (
    SELECT * FROM tier1
    UNION ALL
    SELECT * FROM tier2
  ),
  ins AS (
    INSERT INTO intelligence_citations
      (subject_type, subject_id, publisher_key, source_name, source_url,
       source_type, confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
    SELECT
      'risk_action_recommendations', sid,
      lower(canonical_source_name),
      coalesce(canonical_source_name, primary_source, 'GDELT cluster'),
      primary_source,
      CASE WHEN official_source THEN 'official' ELSE 'media' END,
      coalesce(source_credibility_score::numeric/100, 0.5),
      coalesce(ingested_at, created_at, now()),
      encode(extensions.digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
      encode(extensions.digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
    FROM combined
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END $$;

GRANT EXECUTE ON FUNCTION public.phase_b_backfill_recs_fast(int) TO service_role;

-- Repoint the cron at the fast function with conservative batch.
-- Old job calls phase_b_backfill_citations('recommendations', 1500) and times out.
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'phase_b_citations_recs';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'phase_b_citations_recs',
  '*/2 * * * *',
  $$SELECT public.phase_b_backfill_recs_fast(300);$$
);