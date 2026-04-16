
CREATE OR REPLACE FUNCTION public.batch_generate_entity_links(_batch_size integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offset int;
  v_inserted int := 0;
  v_trade_inserted int := 0;
BEGIN
  INSERT INTO backfill_state (key, value_int) VALUES ('entity_link_offset', 0)
  ON CONFLICT (key) DO NOTHING;
  SELECT value_int INTO v_offset FROM backfill_state WHERE key = 'entity_link_offset';

  -- Phase 1: Geographic proximity (borders)
  WITH src AS (
    SELECT id, iso3, lat, lon
    FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND sovereignty_status IN ('sovereign_state','territory','disputed')
      AND lat IS NOT NULL AND lon IS NOT NULL
    ORDER BY id OFFSET v_offset LIMIT _batch_size
  ),
  geo_pairs AS (
    SELECT s.id AS sid, t.id AS tid
    FROM src s
    JOIN canonical_entities t ON t.entity_type IN ('country','territory')
      AND t.sovereignty_status IN ('sovereign_state','territory','disputed')
      AND t.lat IS NOT NULL AND t.lon IS NOT NULL
      AND t.id > s.id
      AND ABS(s.lat - t.lat) < 15 AND ABS(s.lon - t.lon) < 20
    LIMIT 2000
  ),
  ins_geo AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT sid, tid, 'borders'::entity_link_type, 0.7,
      jsonb_build_object('generated_by', 'batch_v2', 'type', 'geographic')
    FROM geo_pairs ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins_geo;

  -- Phase 2: Trade links from shared economic metrics
  WITH src AS (
    SELECT id, iso3 FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND sovereignty_status IN ('sovereign_state','territory','disputed')
      AND iso3 IS NOT NULL
    ORDER BY id OFFSET v_offset LIMIT _batch_size
  ),
  trade_pairs AS (
    SELECT DISTINCT s.id AS sid, ce2.id AS tid
    FROM src s
    JOIN normalized_metrics nm1 ON nm1.iso3 = s.iso3 AND nm1.domain IN ('finance','economy','trade')
    JOIN normalized_metrics nm2 ON nm2.metric_name = nm1.metric_name AND nm2.iso3 != s.iso3
    JOIN canonical_entities ce2 ON ce2.iso3 = nm2.iso3 AND ce2.entity_type IN ('country','territory')
    WHERE s.id < ce2.id
    LIMIT 1000
  ),
  ins_trade AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT sid, tid, 'trades_in'::entity_link_type, 0.6,
      jsonb_build_object('generated_by', 'batch_v2', 'type', 'economic_co_occurrence')
    FROM trade_pairs ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT COUNT(*) INTO v_trade_inserted FROM ins_trade;

  v_inserted := v_inserted + v_trade_inserted;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now()
  WHERE key = 'entity_link_offset';

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted = 0 AND v_offset > 0 THEN 'complete' ELSE 'running' END,
    'offset', v_offset, 'inserted', v_inserted
  );
END;
$$;
