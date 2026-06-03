-- ============================================================================
-- Sweep 17 — Phase B: Authority Ingestion, Citation Backfill,
--                     Knowledge Graph Population, Ledger Back-Chaining
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Country entity_identifiers (iso3 scheme) -------------------------------
INSERT INTO entity_identifiers (scheme, identifier, entity_id, source, confidence, retrieved_at)
SELECT 'iso3', iso3, entity_id, 'canonical_country_list', 1.0, now()
FROM (
  SELECT DISTINCT ON (iso3) iso3, id AS entity_id
  FROM canonical_country_list
  WHERE iso3 IS NOT NULL AND length(iso3)=3
  ORDER BY iso3, id
) c
ON CONFLICT (scheme, identifier) DO NOTHING;

-- 2. International organisations seed ---------------------------------------
INSERT INTO entity_identifiers (scheme, identifier, entity_id, source, confidence, retrieved_at)
SELECT scheme, identifier, gen_random_uuid(), 'phase_b_seed:'||name, 0.98, now()
FROM (VALUES
  ('lei','XJYHHFAV9G3FQ2VFY750','International Monetary Fund'),
  ('lei','254900SQHWXAHM4PCA64','World Bank Group'),
  ('org_key','WHO','World Health Organization'),
  ('org_key','UN','United Nations'),
  ('org_key','OECD','OECD'),
  ('org_key','BIS','Bank for International Settlements'),
  ('org_key','ECB','European Central Bank'),
  ('org_key','FED','US Federal Reserve'),
  ('org_key','BOE','Bank of England'),
  ('org_key','BOJ','Bank of Japan'),
  ('org_key','PBOC','People''s Bank of China'),
  ('org_key','IAEA','International Atomic Energy Agency'),
  ('org_key','OPEC','OPEC'),
  ('org_key','NATO','NATO'),
  ('org_key','EU','European Union'),
  ('org_key','WTO','World Trade Organization'),
  ('org_key','FAO','Food and Agriculture Organization'),
  ('org_key','UNHCR','UN High Commissioner for Refugees'),
  ('org_key','OCHA','UN OCHA'),
  ('org_key','ICAO','International Civil Aviation Organization')
) AS s(scheme,identifier,name)
ON CONFLICT (scheme, identifier) DO NOTHING;

-- 3. KG link builder (adjacency_v3 → entity_links + provenance) -------------
CREATE OR REPLACE FUNCTION public.phase_b_build_kg_links(p_batch integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_inserted integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _kg_new_links (id uuid) ON COMMIT DROP;
  TRUNCATE _kg_new_links;

  WITH cand AS (
    SELECT a.origin_iso3, a.target_iso3, a.strength, a.distance_km,
           a.shared_metrics, a.trade_link, a.computed_at,
           s.entity_id AS s_eid, t.entity_id AS t_eid
    FROM adjacency_v3 a
    JOIN entity_identifiers s ON s.scheme='iso3' AND s.identifier=a.origin_iso3
    JOIN entity_identifiers t ON t.scheme='iso3' AND t.identifier=a.target_iso3
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_links el
      WHERE el.source_entity_id=s.entity_id
        AND el.target_entity_id=t.entity_id
        AND el.source='adjacency_v3'
    )
    LIMIT p_batch
  ),
  ins AS (
    INSERT INTO entity_links
      (source_entity_id, target_entity_id, link_type, strength, source, metadata,
       provenance_source, provenance_confidence, provenance_observed_at)
    SELECT c.s_eid, c.t_eid,
           CASE WHEN c.trade_link THEN 'trades_in'::entity_link_type
                ELSE 'borders'::entity_link_type END,
           c.strength, 'adjacency_v3',
           jsonb_build_object('distance_km',c.distance_km,'shared_metrics',c.shared_metrics),
           'adjacency_v3', 0.85, c.computed_at
    FROM cand c
    RETURNING id
  )
  INSERT INTO _kg_new_links SELECT id FROM ins;

  INSERT INTO entity_link_provenance
    (entity_link_id, source, evidence_url, confidence, retrieved_at)
  SELECT id, 'adjacency_v3', 'internal://adjacency_v3', 0.85, now()
  FROM _kg_new_links;

  SELECT count(*) INTO v_inserted FROM _kg_new_links;
  RETURN v_inserted;
END $$;

-- 4. Citation backfill (warnings + recommendations) -------------------------
CREATE OR REPLACE FUNCTION public.phase_b_backfill_citations(
  p_subject_type text, p_batch integer DEFAULT 300
) RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_count integer := 0;
BEGIN
  IF p_subject_type = 'aicis_early_warnings' THEN
    WITH cand AS (
      SELECT w.id, w.iso3, w.first_detected_at, w.last_updated_at, w.resolved_at
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
             coalesce(canonical_source_name, 'gdelt'),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'),
             primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
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
        WHERE c.country_iso3 = ANY(gs.affected_countries)
          AND gs.primary_source IS NOT NULL
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
             coalesce(canonical_source_name, 'gdelt'),
             coalesce(canonical_source_name, primary_source, 'GDELT cluster'),
             primary_source,
             CASE WHEN official_source THEN 'official' ELSE 'media' END,
             coalesce(source_credibility_score::numeric/100, 0.5),
             coalesce(ingested_at, created_at, now()),
             encode(digest(coalesce(primary_source,'')||sid::text,'sha256'),'hex'),
             encode(digest(coalesce(normalized_summary,summary,'')||sid::text,'sha256'),'hex')
      FROM matched
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
  END IF;
  RETURN v_count;
END $$;

-- 5. Ledger back-chain function ---------------------------------------------
CREATE OR REPLACE FUNCTION public.phase_b_backchain_ledger(
  p_source_table text, p_batch integer DEFAULT 200
) RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r record; v_count integer := 0;
BEGIN
  IF p_source_table = 'aicis_early_warnings' THEN
    FOR r IN
      SELECT w.id, w.iso3, w.event_type, w.severity, w.confidence, w.first_detected_at
      FROM aicis_early_warnings w
      WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le
                        WHERE le.entry_type::text='crisis'
                          AND le.payload->>'subject_id'=w.id::text)
      ORDER BY w.first_detected_at ASC
      LIMIT p_batch
    LOOP
      PERFORM ledger_append('crisis', jsonb_build_object(
        'subject_id', r.id, 'iso3', r.iso3, 'event_type', r.event_type,
        'severity', r.severity, 'confidence', r.confidence,
        'first_detected_at', r.first_detected_at, 'backchain', true));
      v_count := v_count + 1;
    END LOOP;
  ELSIF p_source_table = 'risk_action_recommendations' THEN
    FOR r IN
      SELECT id, country_iso3, domain, intervention_type, urgency_window, generated_at
      FROM risk_action_recommendations
      WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le
                        WHERE le.entry_type::text='recommendation'
                          AND le.payload->>'subject_id'=risk_action_recommendations.id::text)
      ORDER BY generated_at ASC
      LIMIT p_batch
    LOOP
      PERFORM ledger_append('recommendation', jsonb_build_object(
        'subject_id', r.id, 'country_iso3', r.country_iso3, 'domain', r.domain,
        'intervention_type', r.intervention_type, 'urgency_window', r.urgency_window,
        'generated_at', r.generated_at, 'backchain', true));
      v_count := v_count + 1;
    END LOOP;
  ELSIF p_source_table = 'risk_ranking_predictions' THEN
    FOR r IN
      SELECT id, country_iso3, domain, generated_at
      FROM risk_ranking_predictions
      WHERE NOT EXISTS (SELECT 1 FROM ledger_entries le
                        WHERE le.entry_type::text='prediction'
                          AND le.payload->>'subject_id'=risk_ranking_predictions.id::text)
      ORDER BY generated_at ASC
      LIMIT p_batch
    LOOP
      PERFORM ledger_append('prediction', jsonb_build_object(
        'subject_id', r.id, 'country_iso3', r.country_iso3, 'domain', r.domain,
        'generated_at', r.generated_at, 'backchain', true));
      v_count := v_count + 1;
    END LOOP;
  END IF;
  RETURN v_count;
END $$;

-- 6. Operator-facing progress view ------------------------------------------
CREATE OR REPLACE VIEW public.phase_b_progress
WITH (security_invoker = true) AS
SELECT 'entity_identifiers'::text AS track,
       (SELECT count(*) FROM entity_identifiers)::bigint AS rows,
       NULL::numeric AS pct_complete
UNION ALL SELECT 'kg_links_adjacency',
  (SELECT count(*) FROM entity_links WHERE source='adjacency_v3'),
  round(100.0*(SELECT count(*) FROM entity_links WHERE source='adjacency_v3')::numeric
        / NULLIF((SELECT count(*) FROM adjacency_v3),0), 2)
UNION ALL SELECT 'citations_warnings',
  (SELECT count(*) FROM intelligence_citations WHERE subject_type='aicis_early_warnings'),
  round(100.0*(SELECT count(*) FROM intelligence_citations WHERE subject_type='aicis_early_warnings')::numeric
        / NULLIF((SELECT count(*) FROM aicis_early_warnings),0), 2)
UNION ALL SELECT 'citations_recommendations',
  (SELECT count(*) FROM intelligence_citations WHERE subject_type='risk_action_recommendations'),
  round(100.0*(SELECT count(*) FROM intelligence_citations WHERE subject_type='risk_action_recommendations')::numeric
        / NULLIF((SELECT count(*) FROM risk_action_recommendations),0), 2)
UNION ALL SELECT 'ledger_crisis_chained',
  (SELECT count(*) FROM ledger_entries WHERE entry_type::text='crisis'),
  round(100.0*(SELECT count(*) FROM ledger_entries WHERE entry_type::text='crisis')::numeric
        / NULLIF((SELECT count(*) FROM aicis_early_warnings),0), 2)
UNION ALL SELECT 'ledger_recommendation_chained',
  (SELECT count(*) FROM ledger_entries WHERE entry_type::text='recommendation'),
  round(100.0*(SELECT count(*) FROM ledger_entries WHERE entry_type::text='recommendation')::numeric
        / NULLIF((SELECT count(*) FROM risk_action_recommendations),0), 2)
UNION ALL SELECT 'ledger_prediction_chained',
  (SELECT count(*) FROM ledger_entries WHERE entry_type::text='prediction'),
  round(100.0*(SELECT count(*) FROM ledger_entries WHERE entry_type::text='prediction')::numeric
        / NULLIF((SELECT count(*) FROM risk_ranking_predictions),0), 2);

GRANT SELECT ON public.phase_b_progress TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_b_build_kg_links(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase_b_backfill_citations(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase_b_backchain_ledger(text,integer) TO service_role;