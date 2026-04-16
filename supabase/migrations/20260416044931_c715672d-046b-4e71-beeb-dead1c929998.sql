
CREATE OR REPLACE FUNCTION public.batch_generate_entity_links(_batch_size integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_offset int;
  v_inserted int := 0;
BEGIN
  SELECT COALESCE(value_int, 0) INTO v_offset FROM backfill_state WHERE key = 'entity_link_offset';
  IF v_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('entity_link_offset', 0);
    v_offset := 0;
  END IF;

  -- Generate geographic proximity links between countries within ~15 degrees
  WITH src AS (
    SELECT id, iso3, lat, lon
    FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND sovereignty_status IN ('sovereign_state','territory','disputed')
      AND lat IS NOT NULL AND lon IS NOT NULL
    ORDER BY id
    OFFSET v_offset LIMIT _batch_size
  ),
  pairs AS (
    SELECT s.id AS sid, t.id AS tid
    FROM src s
    JOIN canonical_entities t ON t.entity_type IN ('country','territory')
      AND t.sovereignty_status IN ('sovereign_state','territory','disputed')
      AND t.lat IS NOT NULL AND t.lon IS NOT NULL
      AND t.id > s.id
      AND ABS(s.lat - t.lat) < 15
      AND ABS(s.lon - t.lon) < 20
    LIMIT 2000
  ),
  ins AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT p.sid, p.tid, 'borders'::entity_link_type, 0.7,
      jsonb_build_object('generated_by', 'batch_generate_entity_links', 'type', 'geographic_proximity')
    FROM pairs p
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now()
  WHERE key = 'entity_link_offset';

  IF NOT FOUND THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('entity_link_offset', v_offset + _batch_size);
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted = 0 AND v_offset > 0 THEN 'complete' ELSE 'running' END,
    'offset', v_offset, 'batch_size', _batch_size, 'inserted', v_inserted
  );
END;
$$;
