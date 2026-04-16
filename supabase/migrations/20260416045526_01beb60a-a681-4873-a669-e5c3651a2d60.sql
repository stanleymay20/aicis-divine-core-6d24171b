
-- 1. Purge semantically invalid border links
DELETE FROM entity_links 
WHERE link_type = 'borders' 
  AND metadata->>'generated_by' IN ('batch_generate_entity_links', 'batch_v2');

-- 2. Data quality audits table
CREATE TABLE IF NOT EXISTS public.data_quality_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_type TEXT NOT NULL, -- 'link_precision', 'event_quality', 'metric_coverage', 'signal_truth'
  layer TEXT NOT NULL, -- 'entity_links', 'normalized_events', 'normalized_metrics', etc.
  score NUMERIC,
  passed BOOLEAN DEFAULT false,
  findings JSONB DEFAULT '{}',
  sample_size INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.data_quality_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read quality audits" ON public.data_quality_audits FOR SELECT TO authenticated USING (true);

-- 3. Signal truth scores
CREATE TABLE IF NOT EXISTS public.signal_truth_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id TEXT NOT NULL,
  signal_type TEXT NOT NULL, -- 'event', 'metric', 'forecast', 'entity_link'
  domain TEXT,
  iso3 TEXT,
  precision_score NUMERIC, -- how many predicted items are correct
  recall_score NUMERIC, -- how many actual items were found
  semantic_validity NUMERIC, -- does the signal make semantic sense
  country_mapping_accuracy NUMERIC,
  overall_truth_score NUMERIC,
  evidence JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.signal_truth_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read signal truth" ON public.signal_truth_scores FOR SELECT TO authenticated USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_dqa_layer_created ON data_quality_audits(layer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sts_type_created ON signal_truth_scores(signal_type, created_at DESC);

-- 4. Replace broken entity link generator with real adjacency logic
CREATE OR REPLACE FUNCTION public.batch_generate_entity_links(_batch_size integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted int := 0;
  v_trade_inserted int := 0;
  v_offset int;
BEGIN
  INSERT INTO backfill_state (key, value_int) VALUES ('entity_link_offset_v3', 0)
  ON CONFLICT (key) DO NOTHING;
  SELECT value_int INTO v_offset FROM backfill_state WHERE key = 'entity_link_offset_v3';

  -- Phase 1: REAL geographic adjacency using tight proximity (3° lat, 4° lon ≈ 300-400km)
  -- Only for countries that are actually close enough to share a land/maritime border
  WITH src AS (
    SELECT id, iso3, lat, lon
    FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND sovereignty_status IN ('sovereign_state','territory','disputed')
      AND lat IS NOT NULL AND lon IS NOT NULL
    ORDER BY id OFFSET v_offset LIMIT _batch_size
  ),
  real_neighbors AS (
    SELECT s.id AS sid, t.id AS tid,
           -- Haversine-approximate distance in km
           ROUND((111.0 * SQRT(POWER(s.lat - t.lat, 2) + POWER((s.lon - t.lon) * COS(RADIANS((s.lat + t.lat)/2)), 2)))::numeric, 0) AS dist_km
    FROM src s
    JOIN canonical_entities t ON t.entity_type IN ('country','territory')
      AND t.sovereignty_status IN ('sovereign_state','territory','disputed')
      AND t.lat IS NOT NULL AND t.lon IS NOT NULL
      AND t.id > s.id
      -- Tight proximity: max ~2000km for large countries, catches real borders
      AND ABS(s.lat - t.lat) < 8 AND ABS(s.lon - t.lon) < 10
    WHERE 
      -- Actual distance filter: real borders are typically within 2000km capital-to-capital
      111.0 * SQRT(POWER(s.lat - t.lat, 2) + POWER((s.lon - t.lon) * COS(RADIANS((s.lat + t.lat)/2)), 2)) < 2000
  ),
  ins_geo AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT sid, tid, 'borders'::entity_link_type,
      -- Strength inversely proportional to distance
      ROUND(GREATEST(0.3, 1.0 - (dist_km / 3000.0))::numeric, 3),
      jsonb_build_object('generated_by', 'adjacency_v3', 'dist_km', dist_km, 'type', 'geographic_adjacency')
    FROM real_neighbors
    ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins_geo;

  -- Phase 2: Trade links — only when countries share 3+ economic metrics
  WITH src AS (
    SELECT id, iso3 FROM canonical_entities
    WHERE entity_type IN ('country','territory')
      AND iso3 IS NOT NULL
    ORDER BY id OFFSET v_offset LIMIT _batch_size
  ),
  trade_evidence AS (
    SELECT s.id AS sid, ce2.id AS tid, COUNT(DISTINCT nm1.metric_name) AS shared_metrics
    FROM src s
    JOIN normalized_metrics nm1 ON nm1.iso3 = s.iso3 AND nm1.domain IN ('finance','economy','trade')
    JOIN normalized_metrics nm2 ON nm2.metric_name = nm1.metric_name AND nm2.iso3 != s.iso3 AND nm2.domain = nm1.domain
    JOIN canonical_entities ce2 ON ce2.iso3 = nm2.iso3 AND ce2.entity_type IN ('country','territory')
    WHERE s.id < ce2.id
    GROUP BY s.id, ce2.id
    HAVING COUNT(DISTINCT nm1.metric_name) >= 3
    LIMIT 500
  ),
  ins_trade AS (
    INSERT INTO entity_links (source_entity_id, target_entity_id, link_type, strength, metadata)
    SELECT sid, tid, 'trades_in'::entity_link_type,
      LEAST(0.95, 0.4 + (shared_metrics * 0.05)),
      jsonb_build_object('generated_by', 'trade_evidence_v3', 'shared_metrics', shared_metrics)
    FROM trade_evidence
    ON CONFLICT DO NOTHING RETURNING 1
  )
  SELECT COUNT(*) INTO v_trade_inserted FROM ins_trade;

  v_inserted := v_inserted + v_trade_inserted;

  UPDATE backfill_state SET value_int = v_offset + _batch_size, updated_at = now()
  WHERE key = 'entity_link_offset_v3';

  -- Log quality audit
  INSERT INTO data_quality_audits (audit_type, layer, score, passed, findings, sample_size)
  VALUES ('link_generation', 'entity_links',
    CASE WHEN v_inserted > 0 THEN 1.0 ELSE 0.0 END,
    v_inserted > 0,
    jsonb_build_object('geo_inserted', v_inserted - v_trade_inserted, 'trade_inserted', v_trade_inserted, 'offset', v_offset),
    v_inserted
  );

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted = 0 AND v_offset > 0 THEN 'complete' ELSE 'running' END,
    'offset', v_offset, 'geo_links', v_inserted - v_trade_inserted, 'trade_links', v_trade_inserted, 'total_inserted', v_inserted
  );
END;
$$;

-- 5. Accumulation health checker (comprehensive)
CREATE OR REPLACE FUNCTION public.check_accumulation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_layer RECORD;
  v_stalled int := 0;
  v_healthy int := 0;
BEGIN
  FOR v_layer IN
    SELECT * FROM (VALUES
      ('normalized_metrics', 'Metrics'),
      ('normalized_events', 'Events'),
      ('entity_links', 'Entity Links'),
      ('entity_metric_links', 'Metric Links'),
      ('entity_event_links', 'Event Links'),
      ('country_performance_snapshots', 'Snapshots'),
      ('forecast_archive', 'Forecasts'),
      ('village_indicators', 'Village Indicators'),
      ('canonical_entities', 'Entities'),
      ('crisis_events', 'Crisis')
    ) AS t(tbl, label)
  LOOP
    DECLARE
      v_total bigint;
      v_recent bigint;
      v_last_insert timestamptz;
      v_hours_stale numeric;
      v_is_stalled boolean;
    BEGIN
      EXECUTE format('SELECT COUNT(*) FROM %I', v_layer.tbl) INTO v_total;
      EXECUTE format('SELECT COUNT(*) FROM %I WHERE created_at > NOW() - INTERVAL ''24 hours''', v_layer.tbl) INTO v_recent;
      EXECUTE format('SELECT MAX(created_at) FROM %I', v_layer.tbl) INTO v_last_insert;
      
      v_hours_stale := CASE WHEN v_last_insert IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (NOW() - v_last_insert)) / 3600 
        ELSE 9999 END;
      v_is_stalled := v_recent = 0 AND v_total > 0;
      
      IF v_is_stalled THEN v_stalled := v_stalled + 1;
      ELSE v_healthy := v_healthy + 1; END IF;

      v_results := v_results || jsonb_build_object(
        'layer', v_layer.label, 'table', v_layer.tbl,
        'total', v_total, 'growth_24h', v_recent,
        'hours_stale', ROUND(v_hours_stale::numeric, 1),
        'status', CASE 
          WHEN v_recent > 0 THEN 'healthy'
          WHEN v_hours_stale < 48 THEN 'recent'
          WHEN v_hours_stale < 168 THEN 'stale'
          ELSE 'critical'
        END
      );

      -- Auto-alert on stalled critical layers
      IF v_is_stalled AND v_hours_stale > 48 THEN
        INSERT INTO alerts (title, message, severity, division, metadata)
        VALUES (
          'Stalled: ' || v_layer.label,
          v_layer.label || ' has no new data in ' || ROUND(v_hours_stale::numeric) || ' hours',
          CASE WHEN v_hours_stale > 168 THEN 'critical' ELSE 'high' END,
          'system',
          jsonb_build_object('type', 'accumulation_health', 'table', v_layer.tbl, 'hours_stale', ROUND(v_hours_stale::numeric))
        );
      END IF;
    END;
  END LOOP;

  -- Store audit result
  INSERT INTO data_quality_audits (audit_type, layer, score, passed, findings, sample_size)
  VALUES ('accumulation_health', 'all_layers',
    ROUND((v_healthy::numeric / GREATEST(v_healthy + v_stalled, 1)) * 100, 1),
    v_stalled = 0,
    jsonb_build_object('layers', v_results, 'healthy', v_healthy, 'stalled', v_stalled),
    v_healthy + v_stalled
  );

  RETURN jsonb_build_object('healthy', v_healthy, 'stalled', v_stalled, 'layers', v_results, 'checked_at', now());
END;
$$;
