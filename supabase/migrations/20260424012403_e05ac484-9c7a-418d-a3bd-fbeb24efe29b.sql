CREATE OR REPLACE FUNCTION public.batch_expand_entities(_batch_size integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phase int := 0;
  v_inserted int := 0;
  v_updated int := 0;
  v_remaining int := 0;
BEGIN
  INSERT INTO backfill_state (key, value_int)
  VALUES ('entity_expand_offset', 0)
  ON CONFLICT (key) DO NOTHING;

  SELECT COALESCE(value_int, 0)
  INTO v_phase
  FROM backfill_state
  WHERE key = 'entity_expand_offset';

  IF v_phase = 0 THEN
    WITH domains AS (
      SELECT DISTINCT domain
      FROM normalized_metrics
      WHERE domain IS NOT NULL
    ),
    ins AS (
      INSERT INTO canonical_entities (
        canonical_name, entity_type, sovereignty_status,
        display_name, trust_score, metadata
      )
      SELECT
        d.domain || ' sector', 'sector', NULL,
        initcap(d.domain) || ' Sector', 0.8,
        jsonb_build_object('generated_from', 'metric_domains')
      FROM domains d
      ON CONFLICT (entity_type, normalized_name) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    UPDATE backfill_state SET value_int = 1, updated_at = now() WHERE key = 'entity_expand_offset';
    RETURN jsonb_build_object('status','running','phase','sectors_from_domains','inserted',v_inserted,'updated',0,'remaining',NULL);
  ELSIF v_phase = 1 THEN
    WITH providers AS (
      SELECT DISTINCT provider_name FROM normalized_metrics WHERE provider_name IS NOT NULL
    ),
    ins AS (
      INSERT INTO canonical_entities (
        canonical_name, entity_type, sovereignty_status,
        display_name, trust_score, metadata
      )
      SELECT
        p.provider_name, 'company', NULL,
        initcap(replace(p.provider_name, '_', ' ')), 0.7,
        jsonb_build_object('type','data_provider','generated_from','provider_names')
      FROM providers p
      ON CONFLICT (entity_type, normalized_name) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    UPDATE backfill_state SET value_int = 2, updated_at = now() WHERE key = 'entity_expand_offset';
    RETURN jsonb_build_object('status','running','phase','institutions_from_providers','inserted',v_inserted,'updated',0,'remaining',NULL);
  END IF;

  -- Phase 2: promote admin_regions to city canonical_entities.
  -- We MUST de-duplicate within the batch by canonical_name (which feeds normalized_name)
  -- to avoid "ON CONFLICT DO UPDATE command cannot affect row a second time".
  WITH batch AS (
    SELECT
      ar.id, ar.name, ar.country_iso3, ar.lat, ar.lon,
      ar.population_est, ar.admin_level
    FROM admin_regions ar
    LEFT JOIN canonical_entities ce
      ON ce.entity_type = 'city'
     AND (ce.metadata->>'admin_region_id')::uuid = ar.id
    WHERE ar.lat IS NOT NULL AND ar.lon IS NOT NULL AND ce.id IS NULL
    ORDER BY ar.admin_level, ar.id
    LIMIT _batch_size
  ),
  -- Collapse duplicates that resolve to the same canonical_name.
  -- Keep the lowest admin_level (most specific / city-like) row per name.
  deduped AS (
    SELECT DISTINCT ON (lower(b.name) || ', ' || b.country_iso3)
      b.id, b.name, b.country_iso3, b.lat, b.lon,
      b.population_est, b.admin_level
    FROM batch b
    ORDER BY lower(b.name) || ', ' || b.country_iso3, b.admin_level, b.id
  ),
  upserted AS (
    INSERT INTO canonical_entities (
      canonical_name, entity_type, iso3, lat, lon,
      trust_score, metadata, display_name
    )
    SELECT
      d.name || ', ' || d.country_iso3,
      'city',
      d.country_iso3,
      d.lat, d.lon,
      0.7,
      jsonb_build_object(
        'admin_level', d.admin_level,
        'population_est', d.population_est,
        'admin_region_id', d.id
      ),
      d.name
    FROM deduped d
    ON CONFLICT (entity_type, normalized_name) DO UPDATE
    SET
      iso3 = EXCLUDED.iso3,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      display_name = EXCLUDED.display_name,
      metadata = COALESCE(canonical_entities.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      updated_at = now()
    RETURNING xmax = 0 AS inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE inserted),
    COUNT(*) FILTER (WHERE NOT inserted)
  INTO v_inserted, v_updated
  FROM upserted;

  SELECT COUNT(*) INTO v_remaining
  FROM admin_regions ar
  LEFT JOIN canonical_entities ce
    ON ce.entity_type = 'city'
   AND (ce.metadata->>'admin_region_id')::uuid = ar.id
  WHERE ar.lat IS NOT NULL AND ar.lon IS NOT NULL AND ce.id IS NULL;

  UPDATE backfill_state SET value_int = 2, updated_at = now() WHERE key = 'entity_expand_offset';

  RETURN jsonb_build_object(
    'status', CASE WHEN v_remaining = 0 THEN 'complete' ELSE 'running' END,
    'phase', 'regions_to_entities',
    'inserted', v_inserted,
    'updated', v_updated,
    'remaining', v_remaining
  );
END;
$function$;