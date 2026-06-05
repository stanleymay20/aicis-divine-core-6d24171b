
-- Phase B v2: Recommendation citation cascading fallback + pattern-based official source classifier

-- 1) Rewrite citation backfill with tiered fallback for risk_action_recommendations
CREATE OR REPLACE FUNCTION public.phase_b_backfill_citations(p_subject_type text, p_batch integer DEFAULT 300)
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public','extensions' AS $$
DECLARE v_count integer := 0;
BEGIN
  IF p_subject_type = 'aicis_early_warnings' THEN
    WITH cand AS (
      SELECT w.id, w.iso3, w.first_detected_at
      FROM aicis_early_warnings w
      WHERE NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type='aicis_early_warnings' AND c.subject_id=w.id)
      ORDER BY w.first_detected_at DESC LIMIT p_batch
    ),
    matched AS (
      SELECT c.id AS sid, g.* FROM cand c
      JOIN LATERAL (
        SELECT * FROM global_signals gs
        WHERE gs.affected_countries @> ARRAY[c.iso3]
          AND gs.primary_source IS NOT NULL AND gs.canonical_source_name IS NOT NULL
          AND gs.latest_update_at >= c.first_detected_at - interval '7 days'
        ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC LIMIT 1
      ) g ON true
    ),
    ins AS (
      INSERT INTO intelligence_citations (subject_type, subject_id, publisher_key, source_name, source_url, source_type, confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
      SELECT 'aicis_early_warnings', sid, lower(canonical_source_name),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'), primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(extensions.digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(extensions.digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
      FROM matched RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;

  ELSIF p_subject_type = 'risk_action_recommendations' THEN
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
      SELECT r.id, r.country_iso3, r.generated_at, r.domain
      FROM risk_action_recommendations r
      WHERE NOT EXISTS (SELECT 1 FROM intelligence_citations c
                        WHERE c.subject_type='risk_action_recommendations' AND c.subject_id=r.id)
      ORDER BY r.id LIMIT p_batch
    ),
    matched AS (
      SELECT c.id AS sid, g.*
      FROM cand c
      JOIN LATERAL (
        SELECT * FROM (
          (SELECT gs.*, 1 AS tier FROM global_signals gs
             WHERE gs.affected_countries @> ARRAY[c.country_iso3]
               AND gs.canonical_source_name IS NOT NULL
               AND gs.latest_update_at BETWEEN c.generated_at - interval '14 days' AND c.generated_at + interval '1 day'
             ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC LIMIT 1)
          UNION ALL
          (SELECT gs.*, 2 AS tier FROM global_signals gs
             WHERE gs.affected_countries @> ARRAY[c.country_iso3]
               AND gs.canonical_source_name IS NOT NULL
             ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC LIMIT 1)
          UNION ALL
          (SELECT gs.*, 3 AS tier FROM global_signals gs
             JOIN adjacency_v3 a ON a.origin_iso3=c.country_iso3 AND gs.affected_countries @> ARRAY[a.target_iso3]
             JOIN domain_cats dc ON dc.domain=c.domain AND gs.category = ANY(dc.cats)
             WHERE gs.canonical_source_name IS NOT NULL
               AND gs.latest_update_at BETWEEN c.generated_at - interval '30 days' AND c.generated_at + interval '1 day'
             ORDER BY a.strength DESC NULLS LAST, gs.source_credibility_score DESC NULLS LAST LIMIT 1)
          UNION ALL
          (SELECT gs.*, 4 AS tier FROM global_signals gs
             JOIN domain_cats dc ON dc.domain=c.domain AND gs.category = ANY(dc.cats)
             WHERE gs.canonical_source_name IS NOT NULL
               AND gs.latest_update_at BETWEEN c.generated_at - interval '30 days' AND c.generated_at + interval '1 day'
             ORDER BY gs.source_credibility_score DESC NULLS LAST, gs.latest_update_at DESC LIMIT 1)
        ) u ORDER BY tier LIMIT 1
      ) g ON true
    ),
    ins AS (
      INSERT INTO intelligence_citations (subject_type, subject_id, publisher_key, source_name, source_url, source_type, confidence_weight, retrieved_at, source_hash, citation_snapshot_hash)
      SELECT 'risk_action_recommendations', sid, lower(canonical_source_name),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'), primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(extensions.digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(extensions.digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
      FROM matched RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
  END IF;
  RETURN v_count;
END $$;

-- 2) Pattern-based official source classifier (works even without registry entries)
CREATE OR REPLACE FUNCTION public.phase_b_classify_official_sources(p_batch integer DEFAULT 10000)
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_count integer := 0;
BEGIN
  WITH target AS (
    SELECT id FROM intelligence_citations
    WHERE source_type <> 'official'
      AND publisher_key IS NOT NULL
      AND publisher_key NOT IN ('executivegov.com','govtech.com','govexec.com','govinfosecurity.com','govoritmoskva.ru','whopam.com','whoscored.com','govbid.com','whotv.com')
      AND (
            EXISTS (SELECT 1 FROM source_authority_registry r WHERE r.publisher_key=intelligence_citations.publisher_key AND r.authority_tier<=2)
         OR publisher_key ~ '(^|\.)gov$'
         OR publisher_key ~ '\.gov\.[a-z]{2}$'
         OR publisher_key ~ '\.gov\.[a-z]{2}\.[a-z]{2,4}$'
         OR publisher_key ~ '(^|\.)mil$'
         OR publisher_key ~ '\.mil\.[a-z]{2}$'
         OR publisher_key ~ '\.go\.[a-z]{2}$'
         OR publisher_key ~ '\.gc\.ca$'
         OR publisher_key ~ '\.gouv\.[a-z]{2}$'
         OR publisher_key ~ '\.admin\.ch$'
         OR publisher_key ~ '\.europa\.eu$'
         OR publisher_key ~ '\.un\.org$' OR publisher_key='un.org'
         OR publisher_key ~ '\.who\.int$' OR publisher_key='who.int'
         OR publisher_key ~ '\.imf\.org$' OR publisher_key='imf.org'
         OR publisher_key ~ '\.worldbank\.org$' OR publisher_key='worldbank.org' OR publisher_key='data.worldbank.org'
         OR publisher_key ~ '\.oecd\.org$' OR publisher_key='oecd.org'
         OR publisher_key ~ '\.wto\.org$' OR publisher_key='wto.org'
         OR publisher_key ~ '\.fao\.org$' OR publisher_key='fao.org'
         OR publisher_key ~ '\.wfp\.org$' OR publisher_key='wfp.org'
         OR publisher_key ~ '\.unicef\.org$' OR publisher_key='unicef.org'
         OR publisher_key ~ '\.unhcr\.org$' OR publisher_key='unhcr.org'
         OR publisher_key ~ '\.wmo\.int$' OR publisher_key='wmo.int'
         OR publisher_key ~ '\.iaea\.org$' OR publisher_key='iaea.org'
         OR publisher_key ~ '\.bis\.org$' OR publisher_key='bis.org'
         OR publisher_key ~ '\.nasa\.gov$' OR publisher_key='nasa.gov'
         OR publisher_key ~ '\.noaa\.gov$' OR publisher_key='noaa.gov'
         OR publisher_key='comtrade.un.org'
         OR publisher_key ~ '\.int$'
      )
    LIMIT p_batch
  ),
  upd AS (
    UPDATE intelligence_citations c SET source_type='official'
    FROM target t WHERE c.id=t.id RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END $$;
