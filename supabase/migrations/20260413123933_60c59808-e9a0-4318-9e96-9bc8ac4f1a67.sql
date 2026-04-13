
-- =============================================================
-- 1. BATCH MIGRATE SNAPSHOTS → normalized_metrics
-- =============================================================
CREATE OR REPLACE FUNCTION public.batch_migrate_snapshots(_batch_size int DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_total int;
  v_inserted int := 0;
BEGIN
  SELECT COALESCE(value_int, 0) INTO v_offset FROM backfill_state WHERE key = 'snapshot_metric_offset';
  IF v_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('snapshot_metric_offset', 0);
    v_offset := 0;
  END IF;

  SELECT COUNT(*) INTO v_total FROM country_performance_snapshots;
  IF v_offset >= v_total THEN
    RETURN jsonb_build_object('status','complete','offset',v_offset,'total',v_total);
  END IF;

  WITH batch AS (
    SELECT * FROM country_performance_snapshots ORDER BY id OFFSET v_offset LIMIT _batch_size
  ),
  ins AS (
    INSERT INTO normalized_metrics (provider_name, domain, metric_name, iso3, period, value, unit, confidence, provenance_source, dedup_key, freshness_score)
    SELECT 'aicis_snapshots', b.domain, m.mn, b.iso3, b.snapshot_date::text,
           m.mv, 'index', b.confidence_score, 'internal://snapshots',
           'snap_' || b.iso3 || '_' || b.domain || '_' || m.mn || '_' || b.snapshot_date, 0.85
    FROM batch b
    CROSS JOIN LATERAL (VALUES
      ('perf_idx', b.performance_index::float8),
      ('risk_pressure', b.risk_pressure_score::float8),
      ('momentum', b.momentum_score::float8),
      ('fragility', b.systemic_fragility_score::float8),
      ('volatility', b.volatility_index::float8),
      ('forecast_stab', b.forecast_stability_score::float8)
    ) AS m(mn, mv)
    WHERE m.mv IS NOT NULL
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now() WHERE key = 'snapshot_metric_offset';

  RETURN jsonb_build_object('status','running','offset',v_offset,'batch_size',_batch_size,'inserted',v_inserted,'total',v_total);
END;
$$;

-- =============================================================
-- 2. BATCH MIGRATE VILLAGES → normalized_metrics
-- =============================================================
CREATE OR REPLACE FUNCTION public.batch_migrate_villages(_batch_size int DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_total int;
  v_inserted int := 0;
BEGIN
  SELECT COALESCE(value_int, 0) INTO v_offset FROM backfill_state WHERE key = 'village_metric_offset';
  IF v_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('village_metric_offset', 0);
    v_offset := 0;
  END IF;

  SELECT COUNT(*) INTO v_total FROM village_indicators;
  IF v_offset >= v_total THEN
    RETURN jsonb_build_object('status','complete','offset',v_offset,'total',v_total);
  END IF;

  WITH batch AS (
    SELECT vi.*, ar.country_iso3
    FROM village_indicators vi
    JOIN admin_regions ar ON ar.id = vi.region_id
    ORDER BY vi.id OFFSET v_offset LIMIT _batch_size
  ),
  ins AS (
    INSERT INTO normalized_metrics (provider_name, domain, metric_name, iso3, period, value, unit, confidence, provenance_source, dedup_key, freshness_score)
    SELECT
      COALESCE(b.data_source, 'village_inference'),
      b.domain,
      b.indicator,
      b.country_iso3,
      COALESCE(b.observed_at::date::text, now()::date::text),
      b.value,
      COALESCE(b.unit, 'index'),
      COALESCE(b.confidence, 0.5),
      'internal://village_indicators/' || b.id,
      'vi_' || b.id,
      CASE WHEN b.confidence >= 0.7 THEN 0.8 ELSE 0.5 END
    FROM batch b
    WHERE b.value IS NOT NULL
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now() WHERE key = 'village_metric_offset';

  RETURN jsonb_build_object('status','running','offset',v_offset,'batch_size',_batch_size,'inserted',v_inserted,'total',v_total);
END;
$$;

-- =============================================================
-- 3. BATCH EXPAND ENTITIES (sectors, institutions, commodities)
-- =============================================================
CREATE OR REPLACE FUNCTION public.batch_expand_entities(_batch_size int DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_inserted int := 0;
  v_phase text;
BEGIN
  SELECT COALESCE(value_int, 0) INTO v_offset FROM backfill_state WHERE key = 'entity_expand_offset';
  IF v_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('entity_expand_offset', 0);
    v_offset := 0;
  END IF;

  -- Phase 1 (offset 0-0): Generate sector entities from metric domains
  IF v_offset = 0 THEN
    v_phase := 'sectors_from_domains';
    WITH domains AS (
      SELECT DISTINCT domain FROM normalized_metrics WHERE domain IS NOT NULL
    ),
    ins AS (
      INSERT INTO canonical_entities (canonical_name, entity_type, sovereignty_status, display_name, trust_score, metadata)
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
  END IF;

  -- Phase 2 (offset 1): Generate institution entities from metric names
  IF v_offset = 1 THEN
    v_phase := 'institutions_from_providers';
    WITH providers AS (
      SELECT DISTINCT provider_name FROM normalized_metrics WHERE provider_name IS NOT NULL
    ),
    ins AS (
      INSERT INTO canonical_entities (canonical_name, entity_type, sovereignty_status, display_name, trust_score, metadata)
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
  END IF;

  -- Phase 3+ (offset 2+): Generate city-level entities from admin_regions not yet promoted
  IF v_offset >= 2 THEN
    v_phase := 'regions_to_entities';
    WITH batch AS (
      SELECT ar.id, ar.name, ar.country_iso3, ar.lat, ar.lon, ar.population_est, ar.admin_level
      FROM admin_regions ar
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_entities ce
        WHERE ce.canonical_name = ar.name || ', ' || ar.country_iso3
          AND ce.entity_type = 'city'
      )
      ORDER BY ar.id
      OFFSET (v_offset - 2) * _batch_size
      LIMIT _batch_size
    ),
    ins AS (
      INSERT INTO canonical_entities (canonical_name, entity_type, iso3, lat, lon, trust_score, metadata, display_name)
      SELECT
        b.name || ', ' || b.country_iso3,
        'city',
        b.country_iso3,
        b.lat, b.lon,
        0.7,
        jsonb_build_object('admin_level', b.admin_level, 'population_est', b.population_est, 'admin_region_id', b.id),
        b.name
      FROM batch b
      ON CONFLICT (entity_type, normalized_name) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    IF v_inserted = 0 AND v_offset > 20 THEN
      RETURN jsonb_build_object('status','complete','phase',v_phase,'offset',v_offset);
    END IF;
  END IF;

  UPDATE backfill_state SET value_int = v_offset + 1, updated_at = now() WHERE key = 'entity_expand_offset';

  RETURN jsonb_build_object('status','running','phase',COALESCE(v_phase,'unknown'),'offset',v_offset,'inserted',v_inserted);
END;
$$;

-- =============================================================
-- 4. BATCH GENERATE LINKS
-- =============================================================
CREATE OR REPLACE FUNCTION public.batch_generate_links(_batch_size int DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset int;
  v_inserted int := 0;
BEGIN
  SELECT COALESCE(value_int, 0) INTO v_offset FROM backfill_state WHERE key = 'link_gen_offset';
  IF v_offset IS NULL THEN
    INSERT INTO backfill_state (key, value_int) VALUES ('link_gen_offset', 0);
    v_offset := 0;
  END IF;

  -- Generate entity_metric_links: map metrics → country entities
  WITH batch AS (
    SELECT nm.id AS metric_id, nm.iso3
    FROM normalized_metrics nm
    WHERE nm.iso3 IS NOT NULL
    ORDER BY nm.id
    OFFSET v_offset LIMIT _batch_size
  ),
  country_map AS (
    SELECT ce.id AS entity_id, ce.iso3
    FROM canonical_entities ce
    WHERE ce.entity_type IN ('country','territory')
      AND ce.sovereignty_status IN ('sovereign_state','territory','disputed')
  ),
  ins AS (
    INSERT INTO entity_metric_links (metric_id, entity_id, link_role, confidence)
    SELECT b.metric_id, cm.entity_id, 'primary_country', 0.95
    FROM batch b
    JOIN country_map cm ON cm.iso3 = b.iso3
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  IF v_inserted = 0 AND v_offset > 0 THEN
    RETURN jsonb_build_object('status','complete','offset',v_offset,'inserted',0);
  END IF;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now() WHERE key = 'link_gen_offset';

  RETURN jsonb_build_object('status','running','offset',v_offset,'batch_size',_batch_size,'inserted',v_inserted);
END;
$$;

-- =============================================================
-- 5. ORCHESTRATOR: runs all batch functions in sequence
-- =============================================================
CREATE OR REPLACE FUNCTION public.planetary_batch_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
BEGIN
  r1 := batch_migrate_snapshots(3000);
  r2 := batch_migrate_villages(5000);
  r3 := batch_expand_entities(2000);
  r4 := batch_generate_links(5000);

  RETURN jsonb_build_object(
    'snapshots', r1,
    'villages', r2,
    'entities', r3,
    'links', r4,
    'tick_at', now()
  );
END;
$$;
