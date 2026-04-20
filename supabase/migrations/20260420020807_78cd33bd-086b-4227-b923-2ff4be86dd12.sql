-- L0: Community / village level metrics
CREATE TABLE IF NOT EXISTS public.community_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID REFERENCES public.admin_regions(id) ON DELETE CASCADE,
  country_iso3 TEXT NOT NULL,
  domain TEXT NOT NULL,
  indicator_key TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT,
  source TEXT DEFAULT 'community_report',
  reporter_node_id UUID REFERENCES public.accountability_nodes(id),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_metrics_region ON public.community_metrics(region_id);
CREATE INDEX IF NOT EXISTS idx_community_metrics_country_domain ON public.community_metrics(country_iso3, domain);
CREATE INDEX IF NOT EXISTS idx_community_metrics_captured ON public.community_metrics(captured_at DESC);

ALTER TABLE public.community_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view community metrics"
  ON public.community_metrics FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert community metrics"
  ON public.community_metrics FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can manage community metrics"
  ON public.community_metrics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- L1: Urban metrics (city/metro)
CREATE TABLE IF NOT EXISTS public.urban_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID REFERENCES public.admin_regions(id) ON DELETE CASCADE,
  country_iso3 TEXT NOT NULL,
  city_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  indicator_key TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT,
  source_count INT DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_urban_metrics_region ON public.urban_metrics(region_id);
CREATE INDEX IF NOT EXISTS idx_urban_metrics_city ON public.urban_metrics(city_name);
CREATE INDEX IF NOT EXISTS idx_urban_metrics_computed ON public.urban_metrics(computed_at DESC);

ALTER TABLE public.urban_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view urban metrics"
  ON public.urban_metrics FOR SELECT USING (true);

CREATE POLICY "Admins manage urban metrics"
  ON public.urban_metrics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- L3: Regional insights (continent / trade bloc)
CREATE TABLE IF NOT EXISTS public.regional_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_name TEXT NOT NULL,
  region_code TEXT,
  countries_included TEXT[] NOT NULL DEFAULT '{}',
  domain TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  trend TEXT,
  confidence NUMERIC DEFAULT 0.5,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regional_insights_region ON public.regional_insights(region_name);
CREATE INDEX IF NOT EXISTS idx_regional_insights_domain ON public.regional_insights(domain);
CREATE INDEX IF NOT EXISTS idx_regional_insights_computed ON public.regional_insights(computed_at DESC);

ALTER TABLE public.regional_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view regional insights"
  ON public.regional_insights FOR SELECT USING (true);

CREATE POLICY "Admins manage regional insights"
  ON public.regional_insights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Cross-border signals
CREATE TABLE IF NOT EXISTS public.cross_border_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  origin_iso3 TEXT NOT NULL,
  affected_iso3 TEXT[] NOT NULL DEFAULT '{}',
  domain TEXT NOT NULL,
  intensity NUMERIC DEFAULT 0,
  description TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cross_border_origin ON public.cross_border_signals(origin_iso3);
CREATE INDEX IF NOT EXISTS idx_cross_border_detected ON public.cross_border_signals(detected_at DESC);

ALTER TABLE public.cross_border_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view cross-border signals"
  ON public.cross_border_signals FOR SELECT USING (true);

CREATE POLICY "Admins manage cross-border signals"
  ON public.cross_border_signals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Federation learning broadcasts (fan-out down)
CREATE TABLE IF NOT EXISTS public.federation_learning_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_type TEXT NOT NULL DEFAULT 'global_prior_update',
  source_tier TEXT NOT NULL DEFAULT 'L4',
  target_tiers TEXT[] NOT NULL DEFAULT ARRAY['L0','L1','L2','L3'],
  payload JSONB NOT NULL,
  delivered_count INT DEFAULT 0,
  broadcast_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fed_broadcasts_at ON public.federation_learning_broadcasts(broadcast_at DESC);

ALTER TABLE public.federation_learning_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view federation broadcasts"
  ON public.federation_learning_broadcasts FOR SELECT USING (true);

CREATE POLICY "Admins manage federation broadcasts"
  ON public.federation_learning_broadcasts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Roll-up RPC: L0 community_metrics → L1 urban_metrics
CREATE OR REPLACE FUNCTION public.rollup_community_to_urban()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT := 0;
BEGIN
  WITH agg AS (
    SELECT
      ar.parent_id AS region_id,
      cm.country_iso3,
      COALESCE(parent.name, 'Unknown') AS city_name,
      cm.domain,
      cm.indicator_key,
      AVG(cm.value) AS value,
      MAX(cm.unit) AS unit,
      COUNT(*) AS source_count
    FROM public.community_metrics cm
    JOIN public.admin_regions ar ON ar.id = cm.region_id
    LEFT JOIN public.admin_regions parent ON parent.id = ar.parent_id
    WHERE cm.captured_at > now() - INTERVAL '24 hours'
      AND ar.parent_id IS NOT NULL
    GROUP BY ar.parent_id, cm.country_iso3, parent.name, cm.domain, cm.indicator_key
  )
  INSERT INTO public.urban_metrics (region_id, country_iso3, city_name, domain, indicator_key, value, unit, source_count)
  SELECT region_id, country_iso3, city_name, domain, indicator_key, value, unit, source_count FROM agg;
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- Roll-up RPC: L2 country_performance → L3 regional_insights
CREATE OR REPLACE FUNCTION public.rollup_country_to_regional()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT := 0;
BEGIN
  WITH region_map AS (
    SELECT iso3, 
      CASE 
        WHEN iso3 IN ('GHA','NGA','SEN','CIV','MLI','BFA','NER','TGO','BEN','GIN','SLE','LBR','GMB','GNB','CPV','MRT') THEN 'West Africa'
        WHEN iso3 IN ('KEN','TZA','UGA','RWA','BDI','ETH','SOM','SDN','SSD','DJI','ERI') THEN 'East Africa'
        WHEN iso3 IN ('ZAF','BWA','NAM','ZMB','ZWE','MOZ','LSO','SWZ','MWI','AGO') THEN 'Southern Africa'
        WHEN iso3 IN ('EGY','LBY','TUN','DZA','MAR') THEN 'North Africa'
        WHEN iso3 IN ('USA','CAN','MEX') THEN 'North America'
        WHEN iso3 IN ('BRA','ARG','CHL','COL','PER','VEN','ECU','BOL','URY','PRY') THEN 'South America'
        WHEN iso3 IN ('CHN','JPN','KOR','MNG','TWN','HKG') THEN 'East Asia'
        WHEN iso3 IN ('IND','PAK','BGD','LKA','NPL','BTN','MDV','AFG') THEN 'South Asia'
        WHEN iso3 IN ('IDN','THA','VNM','PHL','MYS','SGP','MMR','KHM','LAO','BRN','TLS') THEN 'Southeast Asia'
        WHEN iso3 IN ('SAU','ARE','QAT','KWT','BHR','OMN','YEM','IRQ','IRN','SYR','LBN','JOR','ISR','PSE','TUR') THEN 'Middle East'
        WHEN iso3 IN ('DEU','FRA','GBR','ITA','ESP','POL','NLD','BEL','CHE','AUT','SWE','NOR','DNK','FIN','IRL','PRT','GRC','CZE','HUN','ROU','BGR','HRV','SVK','SVN','LTU','LVA','EST','LUX','MLT','CYP') THEN 'Europe'
        WHEN iso3 IN ('AUS','NZL','PNG','FJI','SLB','VUT','WSM','TON','KIR','TUV','NRU','PLW','FSM','MHL') THEN 'Oceania'
        ELSE 'Other'
      END AS region_name
    FROM (SELECT DISTINCT iso3 FROM public.country_performance_snapshots) c
  )
  INSERT INTO public.regional_insights (region_name, countries_included, domain, metric_key, metric_value, trend, confidence)
  SELECT
    rm.region_name,
    array_agg(DISTINCT cps.iso3),
    cps.domain,
    'avg_performance_index',
    AVG(cps.performance_index),
    CASE WHEN AVG(cps.momentum_score) > 0 THEN 'improving' WHEN AVG(cps.momentum_score) < 0 THEN 'declining' ELSE 'stable' END,
    AVG(cps.confidence_score)
  FROM public.country_performance_snapshots cps
  JOIN region_map rm ON rm.iso3 = cps.iso3
  WHERE cps.snapshot_date > CURRENT_DATE - INTERVAL '7 days'
    AND rm.region_name != 'Other'
  GROUP BY rm.region_name, cps.domain;
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;