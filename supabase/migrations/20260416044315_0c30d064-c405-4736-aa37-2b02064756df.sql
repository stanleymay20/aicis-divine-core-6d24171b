
CREATE OR REPLACE FUNCTION public.batch_generate_entity_links(_batch_size integer DEFAULT 2000)
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

  WITH country_entities AS (
    SELECT ce.id, ce.iso3
    FROM canonical_entities ce
    WHERE ce.entity_type IN ('country','territory')
      AND ce.sovereignty_status IN ('sovereign_state','territory','disputed')
      AND ce.iso3 IS NOT NULL
    ORDER BY ce.iso3
    OFFSET v_offset LIMIT _batch_size
  ),
  domain_pairs AS (
    SELECT DISTINCT
      ce1.id AS source_id,
      ce2.id AS target_id
    FROM country_entities ce1
    JOIN normalized_metrics nm1 ON nm1.iso3 = ce1.iso3
    JOIN normalized_metrics nm2 ON nm2.domain = nm1.domain AND nm2.metric_name = nm1.metric_name AND nm2.iso3 != ce1.iso3
    JOIN canonical_entities ce2 ON ce2.iso3 = nm2.iso3 AND ce2.entity_type IN ('country','territory')
    WHERE ce1.id < ce2.id
    LIMIT 5000
  ),
  ins AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT 
      dp.source_id, dp.target_id, 'trades_in'::entity_link_type,
      0.6,
      jsonb_build_object('generated_by', 'batch_generate_entity_links')
    FROM domain_pairs dp
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now() WHERE key = 'entity_link_offset';

  RETURN jsonb_build_object('status', CASE WHEN v_inserted = 0 AND v_offset > 0 THEN 'complete' ELSE 'running' END, 'offset', v_offset, 'batch_size', _batch_size, 'inserted', v_inserted);
END;
$$;
