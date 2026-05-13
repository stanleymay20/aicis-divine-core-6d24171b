-- True Global Telemetry Mesh
-- Converts AICIS telemetry from selected watchlists to planetary grid coverage.
-- This creates database-driven global coverage cells, sharding, strategic zones,
-- coverage-run tracking, and orchestration helpers for telemetry edge functions.

-- =====================================================
-- 1. Planetary telemetry coverage cells
-- =====================================================
CREATE TABLE IF NOT EXISTS public.global_telemetry_coverage_cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_key text UNIQUE NOT NULL,
  cell_type text NOT NULL DEFAULT 'geo_grid',
  coverage_domain text NOT NULL,
  label text,
  iso3 text DEFAULT 'GLOBAL',
  region_group text,
  min_lat numeric NOT NULL,
  max_lat numeric NOT NULL,
  min_lon numeric NOT NULL,
  max_lon numeric NOT NULL,
  centroid_lat numeric GENERATED ALWAYS AS ((min_lat + max_lat) / 2) STORED,
  centroid_lon numeric GENERATED ALWAYS AS ((min_lon + max_lon) / 2) STORED,
  priority_tier text DEFAULT 'global_baseline',
  polling_interval_seconds integer DEFAULT 3600,
  shard_key integer DEFAULT 0,
  active boolean DEFAULT true,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer DEFAULT 0,
  last_observation_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_cells_domain_active_shard
ON public.global_telemetry_coverage_cells(coverage_domain, active, shard_key);

CREATE INDEX IF NOT EXISTS idx_global_cells_due
ON public.global_telemetry_coverage_cells(coverage_domain, active, last_polled_at);

CREATE INDEX IF NOT EXISTS idx_global_cells_priority
ON public.global_telemetry_coverage_cells(priority_tier, active, coverage_domain);

-- =====================================================
-- 2. Strategic global overlay zones
-- These are not the whole system. They are high-priority overlays on top of global cells.
-- =====================================================
CREATE TABLE IF NOT EXISTS public.global_strategic_watch_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_key text UNIQUE NOT NULL,
  zone_name text NOT NULL,
  zone_type text NOT NULL,
  coverage_domain text NOT NULL,
  iso3 text DEFAULT 'GLOBAL',
  region_group text,
  min_lat numeric NOT NULL,
  max_lat numeric NOT NULL,
  min_lon numeric NOT NULL,
  max_lon numeric NOT NULL,
  strategic_importance numeric DEFAULT 50,
  priority_tier text DEFAULT 'strategic',
  active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_zones_domain_importance
ON public.global_strategic_watch_zones(coverage_domain, strategic_importance DESC);

-- =====================================================
-- 3. Coverage run tracking
-- =====================================================
CREATE TABLE IF NOT EXISTS public.global_telemetry_coverage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text UNIQUE NOT NULL,
  coverage_domain text NOT NULL,
  shard_key integer,
  cells_attempted integer DEFAULT 0,
  cells_successful integer DEFAULT 0,
  observations_inserted integer DEFAULT 0,
  coverage_completeness_score numeric DEFAULT 0,
  run_status text DEFAULT 'started',
  error_summary text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_coverage_runs_domain_time
ON public.global_telemetry_coverage_runs(coverage_domain, started_at DESC);

-- =====================================================
-- 4. Seed global weather mesh: 15-degree grid
-- 9 latitude bands x 24 longitude bands = 216 global baseline weather cells.
-- =====================================================
INSERT INTO public.global_telemetry_coverage_cells (
  cell_key,
  cell_type,
  coverage_domain,
  label,
  iso3,
  region_group,
  min_lat,
  max_lat,
  min_lon,
  max_lon,
  priority_tier,
  polling_interval_seconds,
  shard_key,
  metadata
)
SELECT
  'weather_grid_' || lat_band::text || '_' || lon_band::text,
  'geo_grid',
  'weather-climate',
  'Weather global cell ' || lat_band::text || '/' || lon_band::text,
  'GLOBAL',
  CASE
    WHEN lat_band >= 45 THEN 'northern-high-latitude'
    WHEN lat_band >= 15 THEN 'northern-mid-latitude'
    WHEN lat_band >= -15 THEN 'tropics'
    WHEN lat_band >= -45 THEN 'southern-mid-latitude'
    ELSE 'southern-high-latitude'
  END,
  lat_band,
  lat_band + 15,
  lon_band,
  lon_band + 15,
  'global_baseline',
  21600,
  abs(((lat_band + 90) / 15)::int * 24 + ((lon_band + 180) / 15)::int) % 12,
  jsonb_build_object('grid_degrees',15,'coverage_model','global_weather_mesh')
FROM generate_series(-60, 60, 15) AS lat_band
CROSS JOIN generate_series(-180, 165, 15) AS lon_band
ON CONFLICT(cell_key) DO UPDATE SET
  coverage_domain = EXCLUDED.coverage_domain,
  active = true,
  polling_interval_seconds = EXCLUDED.polling_interval_seconds,
  shard_key = EXCLUDED.shard_key,
  metadata = EXCLUDED.metadata,
  updated_at = now();

-- =====================================================
-- 5. Seed global aviation mesh: 30-degree grid
-- 5 latitude bands x 12 longitude bands = 60 global baseline aviation cells.
-- =====================================================
INSERT INTO public.global_telemetry_coverage_cells (
  cell_key,
  cell_type,
  coverage_domain,
  label,
  iso3,
  region_group,
  min_lat,
  max_lat,
  min_lon,
  max_lon,
  priority_tier,
  polling_interval_seconds,
  shard_key,
  metadata
)
SELECT
  'aviation_grid_' || lat_band::text || '_' || lon_band::text,
  'geo_box',
  'aviation-logistics',
  'Aviation global cell ' || lat_band::text || '/' || lon_band::text,
  'GLOBAL',
  CASE
    WHEN lat_band >= 30 THEN 'northern-aviation'
    WHEN lat_band >= -30 THEN 'equatorial-aviation'
    ELSE 'southern-aviation'
  END,
  lat_band,
  lat_band + 30,
  lon_band,
  lon_band + 30,
  'global_baseline',
  3600,
  abs(((lat_band + 90) / 30)::int * 12 + ((lon_band + 180) / 30)::int) % 12,
  jsonb_build_object('grid_degrees',30,'coverage_model','global_aviation_mesh')
FROM generate_series(-60, 60, 30) AS lat_band
CROSS JOIN generate_series(-180, 150, 30) AS lon_band
ON CONFLICT(cell_key) DO UPDATE SET
  coverage_domain = EXCLUDED.coverage_domain,
  active = true,
  polling_interval_seconds = EXCLUDED.polling_interval_seconds,
  shard_key = EXCLUDED.shard_key,
  metadata = EXCLUDED.metadata,
  updated_at = now();

-- =====================================================
-- 6. Seed global maritime strategic overlays
-- =====================================================
INSERT INTO public.global_strategic_watch_zones (
  zone_key, zone_name, zone_type, coverage_domain, iso3, region_group,
  min_lat, max_lat, min_lon, max_lon, strategic_importance, priority_tier, metadata
)
VALUES
('singapore_strait','Singapore Strait','maritime-chokepoint','shipping-logistics','SGP','southeast-asia',0.8,1.6,103.4,104.3,100,'critical',jsonb_build_object('reason','major global maritime chokepoint')),
('malacca_strait','Malacca Strait','maritime-chokepoint','shipping-logistics','MYS','southeast-asia',1.0,6.5,99.0,104.5,100,'critical',jsonb_build_object('reason','energy and trade chokepoint')),
('suez_canal','Suez Canal','maritime-chokepoint','shipping-logistics','EGY','middle-east',29.7,31.4,32.2,33.0,100,'critical',jsonb_build_object('reason','Europe-Asia trade chokepoint')),
('panama_canal','Panama Canal','maritime-chokepoint','shipping-logistics','PAN','latin-america',8.7,9.5,-80.2,-79.3,98,'critical',jsonb_build_object('reason','Atlantic-Pacific trade chokepoint')),
('strait_of_hormuz','Strait of Hormuz','maritime-chokepoint','shipping-logistics','IRN','middle-east',25.0,27.5,54.0,58.0,100,'critical',jsonb_build_object('reason','global oil chokepoint')),
('bab_el_mandeb','Bab el-Mandeb','maritime-chokepoint','shipping-logistics','YEM','middle-east',11.5,13.5,42.0,44.5,98,'critical',jsonb_build_object('reason','Red Sea chokepoint')),
('bosporus','Bosporus Strait','maritime-chokepoint','shipping-logistics','TUR','europe-middle-east',40.8,41.4,28.7,29.4,90,'strategic',jsonb_build_object('reason','Black Sea access')),
('gibraltar','Strait of Gibraltar','maritime-chokepoint','shipping-logistics','ESP','europe-africa',35.7,36.3,-6.2,-4.8,90,'strategic',jsonb_build_object('reason','Mediterranean-Atlantic access')),
('rotterdam','Port of Rotterdam','major-port','shipping-logistics','NLD','europe',51.7,52.2,3.6,4.7,90,'strategic',jsonb_build_object('reason','major European port')),
('shanghai','Shanghai Port','major-port','shipping-logistics','CHN','east-asia',30.6,31.8,121.0,122.4,95,'critical',jsonb_build_object('reason','major global container port')),
('la_long_beach','Los Angeles / Long Beach','major-port','shipping-logistics','USA','north-america',33.4,34.2,-118.8,-117.8,95,'critical',jsonb_build_object('reason','major US container gateway')),
('tema','Tema Port','major-port','shipping-logistics','GHA','africa',5.4,5.8,-0.2,0.2,75,'strategic',jsonb_build_object('reason','West African port')),
('lagos_apapa','Lagos / Apapa Port','major-port','shipping-logistics','NGA','africa',6.2,6.7,3.1,3.8,80,'strategic',jsonb_build_object('reason','major West African port')),
('jebel_ali','Jebel Ali Port','major-port','shipping-logistics','ARE','middle-east',24.8,25.2,54.8,55.3,90,'strategic',jsonb_build_object('reason','Middle East logistics hub')),
('mumbai_nhava_sheva','Mumbai / Nhava Sheva','major-port','shipping-logistics','IND','south-asia',18.7,19.3,72.7,73.2,85,'strategic',jsonb_build_object('reason','major Indian port')),
('colombo','Colombo Port','major-port','shipping-logistics','LKA','south-asia',6.7,7.1,79.6,80.0,82,'strategic',jsonb_build_object('reason','Indian Ocean transshipment'))
ON CONFLICT(zone_key) DO UPDATE SET
  strategic_importance = EXCLUDED.strategic_importance,
  priority_tier = EXCLUDED.priority_tier,
  active = true,
  metadata = EXCLUDED.metadata,
  updated_at = now();

-- =====================================================
-- 7. Due-cell selector for edge functions
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_due_global_telemetry_cells(
  p_coverage_domain text,
  p_shard_key integer DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  cell_key text,
  coverage_domain text,
  label text,
  iso3 text,
  region_group text,
  min_lat numeric,
  max_lat numeric,
  min_lon numeric,
  max_lon numeric,
  centroid_lat numeric,
  centroid_lon numeric,
  priority_tier text,
  polling_interval_seconds integer,
  shard_key integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.cell_key,
    c.coverage_domain,
    c.label,
    c.iso3,
    c.region_group,
    c.min_lat,
    c.max_lat,
    c.min_lon,
    c.max_lon,
    c.centroid_lat,
    c.centroid_lon,
    c.priority_tier,
    c.polling_interval_seconds,
    c.shard_key
  FROM public.global_telemetry_coverage_cells c
  WHERE c.coverage_domain = p_coverage_domain
    AND c.active = true
    AND (p_shard_key IS NULL OR c.shard_key = p_shard_key)
    AND (
      c.last_polled_at IS NULL
      OR c.last_polled_at <= now() - make_interval(secs => c.polling_interval_seconds)
    )
  ORDER BY
    CASE c.priority_tier
      WHEN 'critical' THEN 1
      WHEN 'strategic' THEN 2
      WHEN 'global_baseline' THEN 3
      ELSE 4
    END,
    c.last_polled_at NULLS FIRST,
    c.cell_key
  LIMIT GREATEST(1, LEAST(p_limit, 250));
$$;

CREATE OR REPLACE FUNCTION public.record_global_cell_poll(
  p_cell_key text,
  p_success boolean,
  p_observation_count integer DEFAULT 0,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failures integer := 0;
BEGIN
  SELECT COALESCE(consecutive_failures,0)
  INTO v_failures
  FROM public.global_telemetry_coverage_cells
  WHERE cell_key = p_cell_key;

  UPDATE public.global_telemetry_coverage_cells
  SET
    last_polled_at = now(),
    last_success_at = CASE WHEN p_success THEN now() ELSE last_success_at END,
    last_failure_at = CASE WHEN NOT p_success THEN now() ELSE last_failure_at END,
    consecutive_failures = CASE WHEN p_success THEN 0 ELSE v_failures + 1 END,
    last_observation_count = p_observation_count,
    metadata = CASE
      WHEN p_error IS NULL THEN metadata
      ELSE jsonb_set(COALESCE(metadata,'{}'::jsonb), '{last_error}', to_jsonb(left(p_error,500)), true)
    END,
    updated_at = now()
  WHERE cell_key = p_cell_key;

  RETURN jsonb_build_object('status','recorded','cell_key',p_cell_key,'success',p_success);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_global_coverage_run(
  p_coverage_domain text,
  p_shard_key integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_key text;
BEGIN
  v_key := md5(p_coverage_domain || '|' || COALESCE(p_shard_key::text,'all') || '|' || now()::text);
  INSERT INTO public.global_telemetry_coverage_runs(run_key, coverage_domain, shard_key, run_status, started_at)
  VALUES (v_key, p_coverage_domain, p_shard_key, 'started', now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_global_coverage_run(
  p_run_id uuid,
  p_cells_attempted integer,
  p_cells_successful integer,
  p_observations_inserted integer,
  p_status text DEFAULT 'success',
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score numeric;
BEGIN
  v_score := CASE
    WHEN p_cells_attempted = 0 THEN 0
    ELSE ROUND((p_cells_successful::numeric / p_cells_attempted::numeric) * 100,2)
  END;

  UPDATE public.global_telemetry_coverage_runs
  SET
    cells_attempted = p_cells_attempted,
    cells_successful = p_cells_successful,
    observations_inserted = p_observations_inserted,
    coverage_completeness_score = v_score,
    run_status = p_status,
    error_summary = p_error,
    completed_at = now()
  WHERE id = p_run_id;

  RETURN jsonb_build_object('status','recorded','coverage_score',v_score);
END;
$$;

CREATE OR REPLACE FUNCTION public.global_telemetry_coverage_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(x))
  INTO v_summary
  FROM (
    SELECT
      coverage_domain,
      COUNT(*) AS total_cells,
      COUNT(*) FILTER (WHERE active) AS active_cells,
      COUNT(*) FILTER (WHERE last_success_at IS NOT NULL) AS activated_cells,
      ROUND((COUNT(*) FILTER (WHERE last_success_at IS NOT NULL)::numeric / NULLIF(COUNT(*),0)) * 100,2) AS activation_percent,
      COUNT(*) FILTER (WHERE consecutive_failures >= 3) AS degraded_cells,
      MAX(last_success_at) AS latest_success
    FROM public.global_telemetry_coverage_cells
    GROUP BY coverage_domain
    ORDER BY coverage_domain
  ) x;

  RETURN COALESCE(v_summary,'[]'::jsonb);
END;
$$;

CREATE OR REPLACE VIEW public.global_telemetry_coverage_command_view AS
SELECT
  coverage_domain,
  COUNT(*) AS total_cells,
  COUNT(*) FILTER (WHERE active) AS active_cells,
  COUNT(*) FILTER (WHERE last_success_at IS NOT NULL) AS activated_cells,
  ROUND((COUNT(*) FILTER (WHERE last_success_at IS NOT NULL)::numeric / NULLIF(COUNT(*),0)) * 100,2) AS activation_percent,
  COUNT(*) FILTER (WHERE consecutive_failures >= 3) AS degraded_cells,
  MIN(last_polled_at) AS oldest_poll,
  MAX(last_success_at) AS latest_success
FROM public.global_telemetry_coverage_cells
GROUP BY coverage_domain
ORDER BY coverage_domain;

CREATE OR REPLACE VIEW public.global_strategic_watch_zone_command_view AS
SELECT
  zone_key,
  zone_name,
  zone_type,
  coverage_domain,
  iso3,
  region_group,
  strategic_importance,
  priority_tier,
  active
FROM public.global_strategic_watch_zones
ORDER BY strategic_importance DESC;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'true-global-telemetry-mesh',
  'success',
  'true global telemetry mesh initialized: 216 weather cells, 60 aviation cells, strategic maritime overlays, shard functions, coverage tracking'
);
