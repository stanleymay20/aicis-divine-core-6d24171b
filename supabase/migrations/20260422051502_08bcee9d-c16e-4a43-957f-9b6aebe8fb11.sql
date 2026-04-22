CREATE OR REPLACE FUNCTION public.get_uncovered_regions(_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  name text,
  admin_level smallint,
  lat double precision,
  lon double precision,
  country_iso3 text,
  population_est bigint,
  urban_rural text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH region_freshness AS (
    SELECT
      ar.id,
      ar.name,
      ar.admin_level,
      ar.lat,
      ar.lon,
      ar.country_iso3,
      ar.population_est,
      ar.urban_rural,
      MAX(COALESCE(vi.observed_at, vi.created_at)) AS latest_indicator_at
    FROM admin_regions ar
    LEFT JOIN village_indicators vi ON vi.region_id = ar.id
    WHERE ar.lat IS NOT NULL AND ar.lon IS NOT NULL
    GROUP BY ar.id, ar.name, ar.admin_level, ar.lat, ar.lon, ar.country_iso3, ar.population_est, ar.urban_rural
  )
  SELECT
    rf.id,
    rf.name,
    rf.admin_level,
    rf.lat,
    rf.lon,
    rf.country_iso3,
    rf.population_est,
    rf.urban_rural
  FROM region_freshness rf
  WHERE rf.latest_indicator_at IS NULL
     OR rf.latest_indicator_at < now() - interval '30 days'
  ORDER BY COALESCE(rf.latest_indicator_at, 'epoch'::timestamptz), rf.admin_level, rf.id
  LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.count_uncovered_regions()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH region_freshness AS (
    SELECT
      ar.id,
      MAX(COALESCE(vi.observed_at, vi.created_at)) AS latest_indicator_at
    FROM admin_regions ar
    LEFT JOIN village_indicators vi ON vi.region_id = ar.id
    WHERE ar.lat IS NOT NULL AND ar.lon IS NOT NULL
    GROUP BY ar.id
  )
  SELECT COUNT(*)
  FROM region_freshness rf
  WHERE rf.latest_indicator_at IS NULL
     OR rf.latest_indicator_at < now() - interval '30 days';
$function$;

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
        canonical_name,
        entity_type,
        sovereignty_status,
        display_name,
        trust_score,
        metadata
      )
      SELECT
        d.domain || ' sector',
        'sector',
        NULL,
        initcap(d.domain) || ' Sector',
        0.8,
        jsonb_build_object('generated_from', 'metric_domains')
      FROM domains d
      ON CONFLICT (entity_type, normalized_name) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    UPDATE backfill_state
    SET value_int = 1, updated_at = now()
    WHERE key = 'entity_expand_offset';

    RETURN jsonb_build_object(
      'status', 'running',
      'phase', 'sectors_from_domains',
      'inserted', v_inserted,
      'updated', 0,
      'remaining', NULL
    );
  ELSIF v_phase = 1 THEN
    WITH providers AS (
      SELECT DISTINCT provider_name
      FROM normalized_metrics
      WHERE provider_name IS NOT NULL
    ),
    ins AS (
      INSERT INTO canonical_entities (
        canonical_name,
        entity_type,
        sovereignty_status,
        display_name,
        trust_score,
        metadata
      )
      SELECT
        p.provider_name,
        'company',
        NULL,
        initcap(replace(p.provider_name, '_', ' ')),
        0.7,
        jsonb_build_object('type', 'data_provider', 'generated_from', 'provider_names')
      FROM providers p
      ON CONFLICT (entity_type, normalized_name) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    UPDATE backfill_state
    SET value_int = 2, updated_at = now()
    WHERE key = 'entity_expand_offset';

    RETURN jsonb_build_object(
      'status', 'running',
      'phase', 'institutions_from_providers',
      'inserted', v_inserted,
      'updated', 0,
      'remaining', NULL
    );
  END IF;

  WITH batch AS (
    SELECT
      ar.id,
      ar.name,
      ar.country_iso3,
      ar.lat,
      ar.lon,
      ar.population_est,
      ar.admin_level
    FROM admin_regions ar
    LEFT JOIN canonical_entities ce
      ON ce.entity_type = 'city'
     AND (ce.metadata->>'admin_region_id')::uuid = ar.id
    WHERE ar.lat IS NOT NULL
      AND ar.lon IS NOT NULL
      AND ce.id IS NULL
    ORDER BY ar.admin_level, ar.id
    LIMIT _batch_size
  ),
  upserted AS (
    INSERT INTO canonical_entities (
      canonical_name,
      entity_type,
      iso3,
      lat,
      lon,
      trust_score,
      metadata,
      display_name
    )
    SELECT
      b.name || ', ' || b.country_iso3,
      'city',
      b.country_iso3,
      b.lat,
      b.lon,
      0.7,
      jsonb_build_object(
        'admin_level', b.admin_level,
        'population_est', b.population_est,
        'admin_region_id', b.id
      ),
      b.name
    FROM batch b
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

  SELECT COUNT(*)
  INTO v_remaining
  FROM admin_regions ar
  LEFT JOIN canonical_entities ce
    ON ce.entity_type = 'city'
   AND (ce.metadata->>'admin_region_id')::uuid = ar.id
  WHERE ar.lat IS NOT NULL
    AND ar.lon IS NOT NULL
    AND ce.id IS NULL;

  UPDATE backfill_state
  SET value_int = 2, updated_at = now()
  WHERE key = 'entity_expand_offset';

  RETURN jsonb_build_object(
    'status', CASE WHEN v_remaining = 0 THEN 'complete' ELSE 'running' END,
    'phase', 'regions_to_entities',
    'inserted', v_inserted,
    'updated', v_updated,
    'remaining', v_remaining
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.batch_generate_entity_links(_batch_size integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
  v_trade_inserted int := 0;
  v_total_candidates int := 0;
  v_saved_offset int := 0;
  v_effective_offset int := 0;
  v_next_offset int := 0;
BEGIN
  INSERT INTO backfill_state (key, value_int)
  VALUES ('entity_link_offset_v3', 0)
  ON CONFLICT (key) DO NOTHING;

  SELECT COALESCE(value_int, 0)
  INTO v_saved_offset
  FROM backfill_state
  WHERE key = 'entity_link_offset_v3';

  SELECT COUNT(*)
  INTO v_total_candidates
  FROM canonical_entities
  WHERE entity_type IN ('country','territory')
    AND sovereignty_status IN ('sovereign_state','territory','disputed')
    AND lat IS NOT NULL
    AND lon IS NOT NULL;

  IF v_total_candidates = 0 THEN
    RETURN jsonb_build_object(
      'status', 'idle',
      'offset', 0,
      'geo_links', 0,
      'trade_links', 0,
      'total_inserted', 0,
      'total_candidates', 0,
      'next_offset', 0
    );
  END IF;

  v_effective_offset := MOD(v_saved_offset, v_total_candidates);

  WITH src AS (
    SELECT id, iso3, lat, lon
    FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND sovereignty_status IN ('sovereign_state','territory','disputed')
      AND lat IS NOT NULL
      AND lon IS NOT NULL
    ORDER BY id
    OFFSET v_effective_offset
    LIMIT _batch_size
  ),
  real_neighbors AS (
    SELECT s.id AS sid, t.id AS tid,
           ROUND((111.0 * SQRT(POWER(s.lat - t.lat, 2) + POWER((s.lon - t.lon) * COS(RADIANS((s.lat + t.lat)/2)), 2)))::numeric, 0) AS dist_km
    FROM src s
    JOIN canonical_entities t
      ON t.entity_type IN ('country','territory')
     AND t.sovereignty_status IN ('sovereign_state','territory','disputed')
     AND t.lat IS NOT NULL
     AND t.lon IS NOT NULL
     AND t.id > s.id
     AND ABS(s.lat - t.lat) < 8
     AND ABS(s.lon - t.lon) < 10
    WHERE 111.0 * SQRT(POWER(s.lat - t.lat, 2) + POWER((s.lon - t.lon) * COS(RADIANS((s.lat + t.lat)/2)), 2)) < 2000
  ),
  ins_geo AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT
      sid,
      tid,
      'borders'::entity_link_type,
      ROUND(GREATEST(0.3, 1.0 - (dist_km / 3000.0))::numeric, 3),
      jsonb_build_object('generated_by', 'adjacency_v3', 'dist_km', dist_km, 'type', 'geographic_adjacency')
    FROM real_neighbors
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins_geo;

  WITH src AS (
    SELECT id, iso3
    FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND iso3 IS NOT NULL
    ORDER BY id
    OFFSET v_effective_offset
    LIMIT _batch_size
  ),
  trade_evidence AS (
    SELECT s.id AS sid, ce2.id AS tid, COUNT(DISTINCT nm1.metric_name) AS shared_metrics
    FROM src s
    JOIN normalized_metrics nm1
      ON nm1.iso3 = s.iso3
     AND nm1.domain IN ('finance','economy','trade')
    JOIN normalized_metrics nm2
      ON nm2.metric_name = nm1.metric_name
     AND nm2.iso3 != s.iso3
     AND nm2.domain = nm1.domain
    JOIN canonical_entities ce2
      ON ce2.iso3 = nm2.iso3
     AND ce2.entity_type IN ('country','territory')
    WHERE s.id < ce2.id
    GROUP BY s.id, ce2.id
    HAVING COUNT(DISTINCT nm1.metric_name) >= 3
    LIMIT 500
  ),
  ins_trade AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT
      sid,
      tid,
      'trades_in'::entity_link_type,
      LEAST(0.95, 0.4 + (shared_metrics * 0.05)),
      jsonb_build_object('generated_by', 'trade_evidence_v3', 'shared_metrics', shared_metrics)
    FROM trade_evidence
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_trade_inserted FROM ins_trade;

  v_inserted := v_inserted + v_trade_inserted;
  v_next_offset := CASE
    WHEN v_effective_offset + _batch_size >= v_total_candidates THEN 0
    ELSE v_effective_offset + _batch_size
  END;

  UPDATE backfill_state
  SET value_int = v_next_offset, updated_at = now()
  WHERE key = 'entity_link_offset_v3';

  INSERT INTO data_quality_audits (audit_type, layer, score, passed, findings, sample_size)
  VALUES (
    'link_generation',
    'entity_links',
    CASE WHEN v_inserted > 0 THEN 1.0 ELSE 0.5 END,
    true,
    jsonb_build_object(
      'geo_inserted', v_inserted - v_trade_inserted,
      'trade_inserted', v_trade_inserted,
      'saved_offset', v_saved_offset,
      'effective_offset', v_effective_offset,
      'next_offset', v_next_offset,
      'total_candidates', v_total_candidates
    ),
    GREATEST(v_inserted, 1)
  );

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted = 0 AND v_next_offset = 0 THEN 'complete' ELSE 'running' END,
    'offset', v_effective_offset,
    'geo_links', v_inserted - v_trade_inserted,
    'trade_links', v_trade_inserted,
    'total_inserted', v_inserted,
    'total_candidates', v_total_candidates,
    'next_offset', v_next_offset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_accumulation_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_layers jsonb := '[]'::jsonb;
  v_layer RECORD;
  v_attention int := 0;
  v_healthy int := 0;
BEGIN
  FOR v_layer IN
    SELECT *
    FROM (
      VALUES
        ('normalized_metrics', 'Metrics', 'created_at', 24::numeric),
        ('normalized_events', 'Events', 'created_at', 24::numeric),
        ('entity_links', 'Entity Links', 'created_at', 168::numeric),
        ('entity_metric_links', 'Metric Links', 'created_at', 72::numeric),
        ('entity_event_links', 'Event Links', 'created_at', 24::numeric),
        ('country_performance_snapshots', 'Snapshots', 'created_at', 24::numeric),
        ('forecast_archive', 'Forecasts', 'created_at', 24::numeric),
        ('village_indicators', 'Village Indicators', 'COALESCE(observed_at, created_at)', 720::numeric),
        ('canonical_entities', 'Entities', 'COALESCE(updated_at, created_at)', 168::numeric),
        ('crisis_events', 'Crisis', 'created_at', 24::numeric)
    ) AS t(tbl, label, freshness_expr, target_hours)
  LOOP
    DECLARE
      v_total bigint;
      v_recent bigint;
      v_last_seen timestamptz;
      v_hours_stale numeric;
      v_status text;
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM %I', v_layer.tbl) INTO v_total;
      EXECUTE format(
        'SELECT COUNT(*) FROM %I WHERE %s > NOW() - INTERVAL ''24 hours''',
        v_layer.tbl,
        v_layer.freshness_expr
      ) INTO v_recent;
      EXECUTE format('SELECT MAX(%s) FROM %I', v_layer.freshness_expr, v_layer.tbl) INTO v_last_seen;

      v_hours_stale := CASE
        WHEN v_last_seen IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - v_last_seen)) / 3600
        ELSE 9999
      END;

      v_status := CASE
        WHEN v_total = 0 THEN 'critical'
        WHEN v_recent > 0 THEN 'healthy'
        WHEN v_hours_stale <= v_layer.target_hours THEN 'recent'
        WHEN v_hours_stale <= v_layer.target_hours * 4 THEN 'stale'
        ELSE 'critical'
      END;

      IF v_status IN ('healthy', 'recent') THEN
        v_healthy := v_healthy + 1;
      ELSE
        v_attention := v_attention + 1;
      END IF;

      v_layers := v_layers || jsonb_build_object(
        'layer', v_layer.label,
        'table', v_layer.tbl,
        'total', v_total,
        'growth_24h', v_recent,
        'hours_stale', ROUND(v_hours_stale::numeric, 1),
        'status', v_status
      );
    EXCEPTION WHEN OTHERS THEN
      v_attention := v_attention + 1;
      v_layers := v_layers || jsonb_build_object(
        'layer', v_layer.label,
        'table', v_layer.tbl,
        'total', 0,
        'growth_24h', 0,
        'hours_stale', 9999,
        'status', 'critical',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'checked_at', NOW(),
    'healthy', v_healthy,
    'stalled', v_attention,
    'layers', v_layers
  );
END;
$function$;