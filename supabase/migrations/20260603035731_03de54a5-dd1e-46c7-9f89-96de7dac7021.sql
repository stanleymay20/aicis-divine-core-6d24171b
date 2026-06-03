CREATE OR REPLACE FUNCTION public.phase_b_build_kg_links(p_batch integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_inserted integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _kg_new_links (id uuid) ON COMMIT DROP;
  TRUNCATE _kg_new_links;

  WITH cand AS (
    SELECT a.origin_iso3, a.target_iso3, a.strength, a.distance_km,
           a.shared_metrics, a.trade_link, a.computed_at,
           s.entity_id AS s_eid, t.entity_id AS t_eid,
           CASE WHEN a.trade_link THEN 'trades_in'::entity_link_type
                ELSE 'borders'::entity_link_type END AS ltype
    FROM adjacency_v3 a
    JOIN entity_identifiers s ON s.scheme='iso3' AND s.identifier=a.origin_iso3
    JOIN entity_identifiers t ON t.scheme='iso3' AND t.identifier=a.target_iso3
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_links el
      WHERE el.source_entity_id=s.entity_id
        AND el.target_entity_id=t.entity_id
        AND el.link_type = CASE WHEN a.trade_link THEN 'trades_in'::entity_link_type
                                ELSE 'borders'::entity_link_type END
    )
    LIMIT p_batch
  ),
  ins AS (
    INSERT INTO entity_links
      (source_entity_id, target_entity_id, link_type, strength, source, metadata,
       provenance_source, provenance_confidence, provenance_observed_at)
    SELECT s_eid, t_eid, ltype, strength, 'adjacency_v3',
           jsonb_build_object('distance_km',distance_km,'shared_metrics',shared_metrics),
           'adjacency_v3', 0.85, computed_at
    FROM cand
    ON CONFLICT (source_entity_id, target_entity_id, link_type) DO NOTHING
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