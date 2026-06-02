
-- =========================================================================
-- SWEEP #13: SYNAPSE LAYER + LEDGER ACTIVATION
-- =========================================================================

-- ---------- 1. adjacency_v3 ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adjacency_v3 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_iso3   text NOT NULL,
  target_iso3   text NOT NULL,
  distance_km   numeric NOT NULL,
  strength      numeric NOT NULL,   -- 1 - dist/2000, clamped [0,1]
  shared_metrics integer DEFAULT 0,
  trade_link    boolean DEFAULT false,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adjacency_v3_uniq UNIQUE (origin_iso3, target_iso3),
  CONSTRAINT adjacency_v3_self_chk CHECK (origin_iso3 <> target_iso3)
);
CREATE INDEX IF NOT EXISTS idx_adjacency_v3_origin ON public.adjacency_v3(origin_iso3);
CREATE INDEX IF NOT EXISTS idx_adjacency_v3_target ON public.adjacency_v3(target_iso3);

GRANT SELECT ON public.adjacency_v3 TO anon, authenticated;
GRANT ALL    ON public.adjacency_v3 TO service_role;

ALTER TABLE public.adjacency_v3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY adjacency_v3_read ON public.adjacency_v3 FOR SELECT USING (true);
CREATE POLICY adjacency_v3_sr   ON public.adjacency_v3
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ---------- 2. cross_domain_correlations -----------------------------------
CREATE TABLE IF NOT EXISTS public.cross_domain_correlations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso3         text NOT NULL,
  domain_a     text NOT NULL,
  domain_b     text NOT NULL,
  correlation  numeric NOT NULL,    -- Pearson on z-scored daily aggregates, [-1,1]
  sample_size  integer NOT NULL,
  window_days  integer NOT NULL DEFAULT 90,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cdc_uniq UNIQUE (iso3, domain_a, domain_b, window_days),
  CONSTRAINT cdc_order_chk CHECK (domain_a < domain_b)
);
CREATE INDEX IF NOT EXISTS idx_cdc_iso3 ON public.cross_domain_correlations(iso3);
CREATE INDEX IF NOT EXISTS idx_cdc_domains ON public.cross_domain_correlations(domain_a, domain_b);

GRANT SELECT ON public.cross_domain_correlations TO anon, authenticated;
GRANT ALL    ON public.cross_domain_correlations TO service_role;

ALTER TABLE public.cross_domain_correlations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cdc_read ON public.cross_domain_correlations FOR SELECT USING (true);
CREATE POLICY cdc_sr   ON public.cross_domain_correlations
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ---------- 3. rebuild_adjacency_v3() --------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_adjacency_v3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count int;
BEGIN
  WITH country_geo AS (
    SELECT iso3, lat, lon
    FROM canonical_entities
    WHERE entity_type = 'country'
      AND iso3 IS NOT NULL
      AND lat IS NOT NULL AND lon IS NOT NULL
  ),
  pairs AS (
    SELECT
      a.iso3 AS origin_iso3,
      b.iso3 AS target_iso3,
      2 * 6371 * asin(sqrt(
        sin(radians((b.lat - a.lat) / 2))^2 +
        cos(radians(a.lat)) * cos(radians(b.lat)) *
        sin(radians((b.lon - a.lon) / 2))^2
      )) AS distance_km
    FROM country_geo a
    JOIN country_geo b ON a.iso3 <> b.iso3
  ),
  filtered AS (
    SELECT origin_iso3, target_iso3, distance_km,
           GREATEST(0, 1 - distance_km / 2000.0) AS strength
    FROM pairs
    WHERE distance_km <= 2000
  ),
  shared AS (
    SELECT f.origin_iso3, f.target_iso3,
           (SELECT count(DISTINCT m1.metric_name)
            FROM normalized_metrics m1
            WHERE m1.iso3 = f.origin_iso3
              AND m1.metric_name IN (
                SELECT DISTINCT m2.metric_name FROM normalized_metrics m2
                WHERE m2.iso3 = f.target_iso3
              )
           ) AS shared_count
    FROM filtered f
  ),
  ins AS (
    INSERT INTO adjacency_v3 (origin_iso3, target_iso3, distance_km, strength, shared_metrics, trade_link, computed_at)
    SELECT f.origin_iso3, f.target_iso3, round(f.distance_km::numeric, 2),
           round(f.strength::numeric, 4),
           COALESCE(s.shared_count, 0),
           COALESCE(s.shared_count, 0) >= 3,
           now()
    FROM filtered f
    LEFT JOIN shared s USING (origin_iso3, target_iso3)
    ON CONFLICT (origin_iso3, target_iso3) DO UPDATE
      SET distance_km = EXCLUDED.distance_km,
          strength = EXCLUDED.strength,
          shared_metrics = EXCLUDED.shared_metrics,
          trade_link = EXCLUDED.trade_link,
          computed_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO inserted_count FROM ins;

  RETURN jsonb_build_object('ok', true, 'rows', inserted_count, 'computed_at', now());
END $$;

-- ---------- 4. rebuild_cross_domain_correlations() -------------------------
CREATE OR REPLACE FUNCTION public.rebuild_cross_domain_correlations(p_window_days int DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count int;
BEGIN
  WITH daily AS (
    SELECT iso3, domain,
           (period)::date AS day,
           avg(value)::numeric AS v
    FROM normalized_metrics
    WHERE iso3 IS NOT NULL
      AND domain IS NOT NULL
      AND value IS NOT NULL
      AND period ~ '^\d{4}-\d{2}-\d{2}$'
      AND (period)::date >= (now() - (p_window_days || ' days')::interval)::date
    GROUP BY iso3, domain, (period)::date
  ),
  pairs AS (
    SELECT d1.iso3, d1.domain AS domain_a, d2.domain AS domain_b,
           corr(d1.v, d2.v) AS r,
           count(*) AS n
    FROM daily d1
    JOIN daily d2 ON d1.iso3 = d2.iso3 AND d1.day = d2.day AND d1.domain < d2.domain
    GROUP BY d1.iso3, d1.domain, d2.domain
    HAVING count(*) >= 8
  ),
  ins AS (
    INSERT INTO cross_domain_correlations (iso3, domain_a, domain_b, correlation, sample_size, window_days, computed_at)
    SELECT iso3, domain_a, domain_b,
           round(COALESCE(r, 0)::numeric, 4),
           n, p_window_days, now()
    FROM pairs
    WHERE r IS NOT NULL
    ON CONFLICT (iso3, domain_a, domain_b, window_days) DO UPDATE
      SET correlation = EXCLUDED.correlation,
          sample_size = EXCLUDED.sample_size,
          computed_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO inserted_count FROM ins;

  RETURN jsonb_build_object('ok', true, 'rows', inserted_count, 'window_days', p_window_days, 'computed_at', now());
END $$;

GRANT EXECUTE ON FUNCTION public.rebuild_adjacency_v3() TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_cross_domain_correlations(int) TO service_role;

-- ---------- 5. ledger_entry_type expansion ---------------------------------
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'prediction';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'export';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'recommendation';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'simulation';
