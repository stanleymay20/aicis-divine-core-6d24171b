
CREATE OR REPLACE FUNCTION public.batch_generate_event_links(p_batch_size int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_primary_count int := 0;
  v_location_count int := 0;
  v_region_count int := 0;
BEGIN
  -- 1. Primary entity links from entity_id
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT ne.id, ne.entity_id, 'primary', 0.9
  FROM normalized_events ne
  WHERE ne.entity_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM entity_event_links eel
      WHERE eel.event_id = ne.id AND eel.entity_id = ne.entity_id AND eel.link_role = 'primary'
    )
  LIMIT p_batch_size
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_primary_count = ROW_COUNT;

  -- 2. Location entity links from location_entity_id
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT ne.id, ne.location_entity_id, 'location', 0.8
  FROM normalized_events ne
  WHERE ne.location_entity_id IS NOT NULL
    AND ne.location_entity_id IS DISTINCT FROM ne.entity_id
    AND NOT EXISTS (
      SELECT 1 FROM entity_event_links eel
      WHERE eel.event_id = ne.id AND eel.entity_id = ne.location_entity_id AND eel.link_role = 'location'
    )
  LIMIT p_batch_size
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_location_count = ROW_COUNT;

  -- 3. Region-matching: link events with iso3 to territory entities
  INSERT INTO entity_event_links (event_id, entity_id, link_role, confidence)
  SELECT ne.id, ce.id, 'primary', 0.7
  FROM normalized_events ne
  JOIN canonical_entities ce
    ON ce.entity_type = 'territory'
    AND (ce.iso3 = ne.iso3 OR ce.canonical_name = ne.iso3)
  WHERE ne.entity_id IS NULL
    AND ne.iso3 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM entity_event_links eel
      WHERE eel.event_id = ne.id AND eel.entity_id = ce.id AND eel.link_role = 'primary'
    )
  LIMIT p_batch_size
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_region_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'primary_links', v_primary_count,
    'location_links', v_location_count,
    'region_links', v_region_count,
    'total', v_primary_count + v_location_count + v_region_count
  );
END;
$$;
