-- Preserve legitimate community metric history while preventing storage runaway.
--
-- The previous retention cron deleted all derived_admin_regions rows older than
-- seven days. That turned community_metrics into a rolling cache and erased
-- longitudinal history. This migration disables age-based deletion and adds a
-- compact current-state table used only for change detection.

DO $$
BEGIN
  PERFORM cron.unschedule('purge-derived-community-metrics');
EXCEPTION
  WHEN OTHERS THEN
    -- Safe when the job is already absent in an environment.
    NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.community_metric_state (
  region_id UUID NOT NULL REFERENCES public.admin_regions(id) ON DELETE CASCADE,
  indicator_key TEXT NOT NULL,
  source TEXT NOT NULL,
  value NUMERIC NOT NULL,
  domain TEXT NOT NULL,
  unit TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (region_id, indicator_key, source)
);

ALTER TABLE public.community_metric_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_metric_state FROM PUBLIC;
REVOKE ALL ON TABLE public.community_metric_state FROM anon;
REVOKE ALL ON TABLE public.community_metric_state FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_metric_state TO service_role;

-- Seed the current state directly from the authoritative admin_regions source.
-- This avoids scanning the very large historical community_metrics table and
-- prevents the first post-migration seeder run from writing a duplicate snapshot.
INSERT INTO public.community_metric_state
  (region_id, indicator_key, source, value, domain, unit, metadata)
SELECT
  ar.id,
  v.indicator_key,
  'derived_admin_regions',
  v.value,
  v.domain,
  v.unit,
  v.metadata
FROM public.admin_regions ar
CROSS JOIN LATERAL (
  VALUES
    (
      'population_estimate'::text,
      ar.population_est::numeric,
      'demographics'::text,
      'persons'::text,
      jsonb_build_object('admin_level', ar.admin_level, 'derivation', 'intrinsic')
    ),
    (
      'population_density_km2'::text,
      CASE
        WHEN COALESCE(ar.area_km2, 0) > 0
          THEN ar.population_est::numeric / ar.area_km2::numeric
        ELSE 0::numeric
      END,
      'demographics'::text,
      'persons_per_km2'::text,
      jsonb_build_object('admin_level', ar.admin_level, 'area_km2', ar.area_km2)
    ),
    (
      'urban_classification'::text,
      CASE WHEN ar.urban_rural = 'urban' THEN 1::numeric ELSE 0::numeric END,
      'settlement'::text,
      'boolean'::text,
      jsonb_build_object('admin_level', ar.admin_level, 'label', COALESCE(ar.urban_rural, 'unknown'))
    )
) AS v(indicator_key, value, domain, unit, metadata)
WHERE ar.admin_level <= 4
  AND ar.population_est IS NOT NULL
  AND ar.population_est > 0
ON CONFLICT (region_id, indicator_key, source) DO UPDATE
SET
  value = EXCLUDED.value,
  domain = EXCLUDED.domain,
  unit = EXCLUDED.unit,
  metadata = EXCLUDED.metadata,
  updated_at = now();

-- Atomic change-aware recorder. Unchanged values only refresh current state;
-- genuinely new or changed values are appended to community_metrics forever.
CREATE OR REPLACE FUNCTION public.record_derived_community_metrics(_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row JSONB;
  _region_id UUID;
  _indicator_key TEXT;
  _value NUMERIC;
  _domain TEXT;
  _unit TEXT;
  _metadata JSONB;
  _country_iso3 TEXT;
  _previous_value NUMERIC;
  _has_state BOOLEAN;
  _inserted INTEGER := 0;
  _captured_at TIMESTAMPTZ := now();
BEGIN
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '_rows must be a JSON array';
  END IF;

  FOR _row IN SELECT value FROM jsonb_array_elements(_rows)
  LOOP
    _region_id := (_row->>'region_id')::uuid;
    _indicator_key := _row->>'indicator_key';
    _value := (_row->>'value')::numeric;
    _domain := _row->>'domain';
    _unit := NULLIF(_row->>'unit', '');
    _metadata := COALESCE(_row->'metadata', '{}'::jsonb);
    _country_iso3 := _row->>'country_iso3';

    IF _region_id IS NULL OR _indicator_key IS NULL OR _value IS NULL
       OR _domain IS NULL OR _country_iso3 IS NULL THEN
      RAISE EXCEPTION 'Invalid derived community metric payload: %', _row;
    END IF;

    SELECT cms.value
      INTO _previous_value
      FROM public.community_metric_state cms
     WHERE cms.region_id = _region_id
       AND cms.indicator_key = _indicator_key
       AND cms.source = 'derived_admin_regions'
     FOR UPDATE;

    _has_state := FOUND;

    IF NOT _has_state OR _previous_value IS DISTINCT FROM _value THEN
      INSERT INTO public.community_metrics (
        region_id,
        country_iso3,
        domain,
        indicator_key,
        value,
        unit,
        source,
        captured_at,
        metadata
      ) VALUES (
        _region_id,
        _country_iso3,
        _domain,
        _indicator_key,
        _value,
        _unit,
        'derived_admin_regions',
        _captured_at,
        _metadata
      );

      _inserted := _inserted + 1;

      INSERT INTO public.community_metric_state (
        region_id,
        indicator_key,
        source,
        value,
        domain,
        unit,
        metadata,
        last_changed_at,
        updated_at
      ) VALUES (
        _region_id,
        _indicator_key,
        'derived_admin_regions',
        _value,
        _domain,
        _unit,
        _metadata,
        _captured_at,
        _captured_at
      )
      ON CONFLICT (region_id, indicator_key, source) DO UPDATE
      SET
        value = EXCLUDED.value,
        domain = EXCLUDED.domain,
        unit = EXCLUDED.unit,
        metadata = EXCLUDED.metadata,
        last_changed_at = EXCLUDED.last_changed_at,
        updated_at = EXCLUDED.updated_at;
    ELSE
      UPDATE public.community_metric_state
         SET domain = _domain,
             unit = _unit,
             metadata = _metadata,
             updated_at = _captured_at
       WHERE region_id = _region_id
         AND indicator_key = _indicator_key
         AND source = 'derived_admin_regions';
    END IF;
  END LOOP;

  RETURN _inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_derived_community_metrics(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_derived_community_metrics(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.record_derived_community_metrics(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_derived_community_metrics(JSONB) TO service_role;

-- Keep the old function signature for compatibility, but make it non-destructive
-- so an accidental/manual call can no longer erase legitimate history.
CREATE OR REPLACE FUNCTION public.purge_derived_community_metrics(
  _batch INT DEFAULT 100000,
  _keep_days INT DEFAULT 7
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_logs (job_name, status, message)
  VALUES (
    'purge-derived-community-metrics',
    'success',
    'No-op: age-based community metric deletion is disabled; history is preserved.'
  );
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_derived_community_metrics(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_derived_community_metrics(INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.purge_derived_community_metrics(INT, INT) FROM authenticated;
