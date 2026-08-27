-- AICIS Telemetry Writer Semantics Bridge v1
--
-- Known provider adapters already encode some semantics in raw_payload and/or
-- only emit rows when provider timestamps are valid. Promote only those proven
-- contracts into first-class columns. Unknown writers remain fail-closed.

CREATE OR REPLACE FUNCTION public.guard_telemetry_observation_truth_floor_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_raw jsonb := COALESCE(NEW.raw_payload, '{}'::jsonb);
  v_payload_time_status text := NULLIF(v_raw ->> 'provider_timestamp_status', '');
  v_payload_anomaly_semantics text := NULLIF(v_raw ->> 'anomaly_score_semantics', '');
  v_payload_value_semantics text := COALESCE(
    NULLIF(v_raw ->> 'observed_data_semantics', ''),
    NULLIF(v_raw ->> 'observation_provenance', '')
  );
BEGIN
  -- Promote provider-time semantics only where the committed writer contract is
  -- explicit. USGS/Open-Meteo/NASA adapters skip rows with invalid provider time.
  -- AIS/OpenSky explicitly mark provider timestamp status in raw_payload.
  IF NEW.observed_at IS NOT NULL
     AND public.aicis_telemetry_semantics_unusable_v1(NEW.observed_at_semantics) THEN
    IF v_payload_time_status = 'provider_supplied' THEN
      NEW.observed_at_semantics := 'provider_reported_observation_time';
    ELSIF NEW.connector_key IN (
      'usgs_earthquake_telemetry',
      'openmeteo_weather_telemetry',
      'openmeteo_global_mesh_telemetry',
      'nasa_eonet_disaster_telemetry'
    ) THEN
      NEW.observed_at_semantics := 'provider_reported_observation_time_writer_validated_v1';
    ELSIF NEW.connector_key = 'maritime_ais_telemetry'
          AND (v_raw ->> 'provider') = 'derived-from-current-ais-payload'
          AND (v_raw ->> 'derivation_time') IS NOT NULL THEN
      NEW.observed_at_semantics := 'system_derivation_time_for_payload_density_not_source_observation_time';
    ELSE
      NEW.reported_observed_at := COALESCE(NEW.reported_observed_at, NEW.observed_at);
      NEW.observed_at := NULL;
      NEW.observed_at_semantics := 'withheld_unlabeled_telemetry_timestamp';
    END IF;
  END IF;

  IF NEW.confidence_score IS NOT NULL
     AND public.aicis_telemetry_semantics_unusable_v1(NEW.confidence_score_semantics) THEN
    NEW.reported_confidence_score := COALESCE(NEW.reported_confidence_score, NEW.confidence_score);
    NEW.confidence_score := NULL;
    NEW.confidence_score_semantics := 'withheld_unlabeled_analytical_confidence';
  END IF;

  IF NEW.anomaly_score IS NOT NULL
     AND public.aicis_telemetry_semantics_unusable_v1(NEW.anomaly_score_semantics) THEN
    IF v_payload_anomaly_semantics IS NOT NULL
       AND NOT public.aicis_telemetry_semantics_unusable_v1(v_payload_anomaly_semantics) THEN
      NEW.anomaly_score_semantics := v_payload_anomaly_semantics;
    ELSE
      NEW.reported_anomaly_score := COALESCE(NEW.reported_anomaly_score, NEW.anomaly_score);
      NEW.anomaly_score := NULL;
      NEW.anomaly_score_semantics := 'withheld_unlabeled_anomaly_score';
    END IF;
  END IF;

  IF NEW.confidence_score IS NULL
     AND (NEW.confidence_score_semantics IS NULL OR btrim(NEW.confidence_score_semantics) = '') THEN
    NEW.confidence_score_semantics := 'not_assessed_at_ingestion';
  END IF;

  IF NEW.anomaly_score IS NULL
     AND (NEW.anomaly_score_semantics IS NULL OR btrim(NEW.anomaly_score_semantics) = '') THEN
    NEW.anomaly_score_semantics := 'not_assessed_at_ingestion';
  END IF;

  IF NEW.observed_at IS NULL
     AND (NEW.observed_at_semantics IS NULL OR btrim(NEW.observed_at_semantics) = '') THEN
    NEW.observed_at_semantics := 'source_observation_time_unknown';
  END IF;

  IF NEW.observation_value_semantics IS NULL OR btrim(NEW.observation_value_semantics) = '' THEN
    NEW.observation_value_semantics := COALESCE(
      v_payload_value_semantics,
      CASE
        WHEN NEW.connector_key IN (
          'usgs_earthquake_telemetry',
          'openmeteo_weather_telemetry',
          'openmeteo_global_mesh_telemetry',
          'nasa_eonet_disaster_telemetry'
        ) THEN 'provider_reported_measurement_or_category_value'
        ELSE 'writer_semantics_not_declared'
      END
    );
  END IF;

  IF NEW.observation_unit_semantics IS NULL OR btrim(NEW.observation_unit_semantics) = '' THEN
    NEW.observation_unit_semantics := CASE
      WHEN NEW.observation_unit IS NULL THEN 'unit_not_applicable_or_unknown'
      ELSE 'writer_reported_or_declared_unit'
    END;
  END IF;

  IF NEW.evidence_status IS NULL OR btrim(NEW.evidence_status) = '' OR NEW.evidence_status = 'legacy_unknown' THEN
    NEW.evidence_status := CASE
      WHEN NEW.observed_at_semantics LIKE 'provider_reported_observation_time%' THEN 'provider_observation'
      WHEN NEW.observed_at_semantics LIKE 'system_derivation_time%' THEN 'derived_observation'
      ELSE 'unassessed'
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_telemetry_observation_truth_floor_v1() IS
  'Fail-closed telemetry guard with explicit bridge for committed provider adapters. It promotes only proven provider/derivation semantics and quarantines all other unlabeled timestamps or analytical scores.';
