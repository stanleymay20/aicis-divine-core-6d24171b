-- Wire compact repeated-observation memory into the change-aware recorder.

ALTER TABLE public.community_metric_observation_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_metric_observation_segments FROM PUBLIC;
REVOKE ALL ON TABLE public.community_metric_observation_segments FROM anon;
REVOKE ALL ON TABLE public.community_metric_observation_segments FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_metric_observation_segments TO service_role;

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
  _current_segment_id UUID;
  _has_state BOOLEAN;
  _inserted INTEGER := 0;
  _captured_at TIMESTAMPTZ := now();
  _new_segment_id UUID;
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

    SELECT cms.value, cms.current_segment_id
      INTO _previous_value, _current_segment_id
      FROM public.community_metric_state cms
     WHERE cms.region_id = _region_id
       AND cms.indicator_key = _indicator_key
       AND cms.source = 'derived_admin_regions'
     FOR UPDATE;

    _has_state := FOUND;

    IF NOT _has_state OR _previous_value IS DISTINCT FROM _value THEN
      INSERT INTO public.community_metrics (
        region_id, country_iso3, domain, indicator_key, value, unit,
        source, captured_at, metadata
      ) VALUES (
        _region_id, _country_iso3, _domain, _indicator_key, _value, _unit,
        'derived_admin_regions', _captured_at, _metadata
      );
      _inserted := _inserted + 1;

      INSERT INTO public.community_metric_observation_segments (
        region_id, indicator_key, source, value, domain, unit, metadata,
        first_observed_at, last_observed_at, observation_count
      ) VALUES (
        _region_id, _indicator_key, 'derived_admin_regions', _value,
        _domain, _unit, _metadata, _captured_at, _captured_at, 1
      ) RETURNING id INTO _new_segment_id;

      INSERT INTO public.community_metric_state (
        region_id, indicator_key, source, value, domain, unit, metadata,
        first_seen_at, last_changed_at, last_confirmed_at, updated_at,
        confirmation_count, change_count, current_segment_id
      ) VALUES (
        _region_id, _indicator_key, 'derived_admin_regions', _value,
        _domain, _unit, _metadata, _captured_at, _captured_at,
        _captured_at, _captured_at, 1, 0, _new_segment_id
      )
      ON CONFLICT (region_id, indicator_key, source) DO UPDATE
      SET value = EXCLUDED.value,
          domain = EXCLUDED.domain,
          unit = EXCLUDED.unit,
          metadata = EXCLUDED.metadata,
          last_changed_at = EXCLUDED.last_changed_at,
          last_confirmed_at = EXCLUDED.last_confirmed_at,
          updated_at = EXCLUDED.updated_at,
          confirmation_count = public.community_metric_state.confirmation_count + 1,
          change_count = public.community_metric_state.change_count + 1,
          current_segment_id = EXCLUDED.current_segment_id;
    ELSE
      IF _current_segment_id IS NULL THEN
        INSERT INTO public.community_metric_observation_segments (
          region_id, indicator_key, source, value, domain, unit, metadata,
          first_observed_at, last_observed_at, observation_count
        ) VALUES (
          _region_id, _indicator_key, 'derived_admin_regions', _value,
          _domain, _unit, _metadata, _captured_at, _captured_at, 1
        ) RETURNING id INTO _current_segment_id;
      ELSE
        UPDATE public.community_metric_observation_segments
           SET last_observed_at = _captured_at,
               observation_count = observation_count + 1,
               domain = _domain,
               unit = _unit,
               metadata = _metadata
         WHERE id = _current_segment_id;
      END IF;

      UPDATE public.community_metric_state
         SET domain = _domain,
             unit = _unit,
             metadata = _metadata,
             last_confirmed_at = _captured_at,
             updated_at = _captured_at,
             confirmation_count = confirmation_count + 1,
             current_segment_id = _current_segment_id
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

COMMENT ON TABLE public.community_metric_observation_segments IS
  'Compact temporal memory of repeated unchanged community metric observations; real changes remain append-only in community_metrics.';
