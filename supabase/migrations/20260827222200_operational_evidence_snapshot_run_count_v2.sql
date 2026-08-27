-- AICIS Governed Operational Evidence Snapshot v2
-- Fixes v1 run bookkeeping before the builder is used: group count is computed
-- before the immutable run row is inserted, and duplicate country codes inside a
-- single signal cannot duplicate evidence within a country/domain snapshot.

CREATE OR REPLACE FUNCTION public.build_operational_evidence_snapshot_v1(
  p_window interval DEFAULT interval '14 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_window_end timestamptz := now();
  v_window_start timestamptz := now() - p_window;
  v_candidates integer := 0;
  v_eligible integer := 0;
  v_excluded_noncanonical integer := 0;
  v_excluded_missing_country integer := 0;
  v_groups integer := 0;
  v_inserted_groups integer := 0;
BEGIN
  IF p_window IS NULL OR p_window <= interval '0 seconds' THEN
    RAISE EXCEPTION 'p_window must be positive';
  END IF;

  SELECT COUNT(*) INTO v_candidates
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) BETWEEN v_window_start AND v_window_end;

  SELECT COUNT(*) INTO v_excluded_noncanonical
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) BETWEEN v_window_start AND v_window_end
    AND gs.canonical_event_status IS DISTINCT FROM 'canonical';

  SELECT COUNT(*) INTO v_excluded_missing_country
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) BETWEEN v_window_start AND v_window_end
    AND gs.canonical_event_status = 'canonical'
    AND (gs.affected_countries IS NULL OR cardinality(gs.affected_countries) = 0);

  SELECT COUNT(*) INTO v_eligible
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) BETWEEN v_window_start AND v_window_end
    AND gs.canonical_event_status = 'canonical'
    AND gs.affected_countries IS NOT NULL
    AND cardinality(gs.affected_countries) > 0;

  SELECT COUNT(*) INTO v_groups
  FROM (
    SELECT DISTINCT upper(country_code) AS country_iso3, gs.category::text AS domain_text
    FROM public.global_signals gs
    CROSS JOIN LATERAL unnest(gs.affected_countries) AS country_code
    WHERE COALESCE(gs.ingested_at, gs.created_at) BETWEEN v_window_start AND v_window_end
      AND gs.canonical_event_status = 'canonical'
      AND gs.affected_countries IS NOT NULL
      AND cardinality(gs.affected_countries) > 0
      AND country_code IS NOT NULL
      AND btrim(country_code) <> ''
      AND gs.category IS NOT NULL
  ) groups_to_build;

  INSERT INTO public.operational_evidence_snapshot_runs(
    generation_batch_id,window_start,window_end,
    candidate_signal_count,eligible_signal_count,
    excluded_noncanonical_count,excluded_missing_country_count,
    snapshot_group_count
  ) VALUES (
    v_batch,v_window_start,v_window_end,
    v_candidates,v_eligible,
    v_excluded_noncanonical,v_excluded_missing_country,
    v_groups
  );

  WITH eligible AS (
    SELECT DISTINCT ON (gs.id, upper(country_code))
      gs.*,
      upper(country_code) AS country_iso3,
      gs.category::text AS domain_text,
      public.aicis_semantics_usable_v1(gs.impact_score_semantics) AS impact_usable,
      public.aicis_semantics_usable_v1(gs.urgency_score_semantics) AS urgency_usable,
      public.aicis_semantics_usable_v1(gs.confidence_score_semantics) AS confidence_usable,
      public.aicis_semantics_usable_v1(gs.source_published_at_semantics) AS published_time_usable,
      public.aicis_semantics_usable_v1(gs.occurred_at_semantics) AS occurrence_time_usable
    FROM public.global_signals gs
    CROSS JOIN LATERAL unnest(gs.affected_countries) AS country_code
    WHERE COALESCE(gs.ingested_at, gs.created_at) BETWEEN v_window_start AND v_window_end
      AND gs.canonical_event_status = 'canonical'
      AND gs.affected_countries IS NOT NULL
      AND cardinality(gs.affected_countries) > 0
      AND country_code IS NOT NULL
      AND btrim(country_code) <> ''
      AND gs.category IS NOT NULL
    ORDER BY gs.id, upper(country_code)
  ), grouped AS (
    SELECT
      country_iso3,
      domain_text,
      COUNT(*)::integer AS source_signal_count,
      COUNT(*) FILTER (WHERE impact_score IS NOT NULL AND impact_usable)::integer AS governed_impact_count,
      COUNT(*) FILTER (WHERE urgency_score IS NOT NULL AND urgency_usable)::integer AS governed_urgency_count,
      COUNT(*) FILTER (WHERE confidence_score IS NOT NULL AND confidence_usable)::integer AS governed_confidence_count,
      COUNT(*) FILTER (WHERE source_independence_status = 'established')::integer AS independently_assessed_signal_count,
      COUNT(*) FILTER (
        WHERE source_independence_status = 'established'
          AND independent_origin_count IS NOT NULL
          AND independent_origin_count >= 2
      )::integer AS independently_corroborated_signal_count,
      COUNT(*) FILTER (WHERE source_published_at IS NOT NULL AND published_time_usable)::integer AS source_published_time_count,
      COUNT(*) FILTER (WHERE occurred_at IS NOT NULL AND occurrence_time_usable)::integer AS occurrence_time_count,
      MAX(COALESCE(latest_update_at, ingested_at, created_at)) AS latest_record_update_at,
      MAX(source_published_at) FILTER (WHERE source_published_at IS NOT NULL AND published_time_usable) AS latest_source_published_at,
      MAX(occurred_at) FILTER (WHERE occurred_at IS NOT NULL AND occurrence_time_usable) AS latest_occurrence_at,
      array_agg(id ORDER BY COALESCE(latest_update_at, ingested_at, created_at) DESC, id) AS signal_ids,
      jsonb_agg(
        jsonb_build_object(
          'signal_id',id,
          'impact_score',CASE WHEN impact_score IS NOT NULL AND impact_usable THEN impact_score ELSE NULL END,
          'impact_score_semantics',impact_score_semantics,
          'urgency_score',CASE WHEN urgency_score IS NOT NULL AND urgency_usable THEN urgency_score ELSE NULL END,
          'urgency_score_semantics',urgency_score_semantics,
          'confidence_score',CASE WHEN confidence_score IS NOT NULL AND confidence_usable THEN confidence_score ELSE NULL END,
          'confidence_score_semantics',confidence_score_semantics,
          'source_independence_status',source_independence_status,
          'independent_origin_count',CASE WHEN source_independence_status = 'established' THEN independent_origin_count ELSE NULL END,
          'source_independence_semantics',source_independence_semantics,
          'source_published_at',CASE WHEN source_published_at IS NOT NULL AND published_time_usable THEN source_published_at ELSE NULL END,
          'source_published_at_semantics',source_published_at_semantics,
          'occurred_at',CASE WHEN occurred_at IS NOT NULL AND occurrence_time_usable THEN occurred_at ELSE NULL END,
          'occurred_at_semantics',occurred_at_semantics,
          'record_updated_at',COALESCE(latest_update_at, ingested_at, created_at),
          'record_time_semantics','system_record_recency_not_event_occurrence_time',
          'evidence_hash',evidence_hash
        )
        ORDER BY COALESCE(latest_update_at, ingested_at, created_at) DESC, id
      ) AS evidence_inventory
    FROM eligible
    GROUP BY country_iso3, domain_text
  )
  INSERT INTO public.operational_evidence_snapshots(
    generation_batch_id,country_iso3,domain,window_start,window_end,
    source_signal_count,governed_impact_count,governed_urgency_count,governed_confidence_count,
    independently_assessed_signal_count,independently_corroborated_signal_count,
    source_published_time_count,occurrence_time_count,
    latest_record_update_at,latest_source_published_at,latest_occurrence_at,
    signal_ids,evidence_inventory,independence_summary,time_coverage_summary,withheld_summary,
    evidence_status
  )
  SELECT
    v_batch,country_iso3,domain_text,v_window_start,v_window_end,
    source_signal_count,governed_impact_count,governed_urgency_count,governed_confidence_count,
    independently_assessed_signal_count,independently_corroborated_signal_count,
    source_published_time_count,occurrence_time_count,
    latest_record_update_at,latest_source_published_at,latest_occurrence_at,
    signal_ids,evidence_inventory,
    jsonb_build_object(
      'assessed_signal_count',independently_assessed_signal_count,
      'corroborated_signal_count',independently_corroborated_signal_count,
      'unassessed_signal_count',source_signal_count - independently_assessed_signal_count,
      'semantics','per_signal_lineage_status_summary_counts_not_summed_origin_count'
    ),
    jsonb_build_object(
      'source_published_time_count',source_published_time_count,
      'occurrence_time_count',occurrence_time_count,
      'record_update_time_count',source_signal_count,
      'latest_record_update_at',latest_record_update_at,
      'latest_source_published_at',latest_source_published_at,
      'latest_occurrence_at',latest_occurrence_at,
      'semantics','record_update_time_is_system_record_recency_not_event_occurrence_time'
    ),
    jsonb_build_object(
      'impact_withheld_or_missing',source_signal_count - governed_impact_count,
      'urgency_withheld_or_missing',source_signal_count - governed_urgency_count,
      'confidence_withheld_or_missing',source_signal_count - governed_confidence_count,
      'independence_unassessed',source_signal_count - independently_assessed_signal_count,
      'source_published_time_missing_or_withheld',source_signal_count - source_published_time_count,
      'occurrence_time_missing_or_withheld',source_signal_count - occurrence_time_count
    ),
    CASE
      WHEN governed_impact_count = 0
       AND governed_urgency_count = 0
       AND governed_confidence_count = 0
        THEN 'evidence_present_no_governed_numeric_signal_scores'
      WHEN independently_assessed_signal_count = 0
        THEN 'governed_signal_scores_present_source_independence_unassessed'
      ELSE 'governed_evidence_inventory_available'
    END
  FROM grouped;

  GET DIAGNOSTICS v_inserted_groups = ROW_COUNT;

  IF v_inserted_groups <> v_groups THEN
    RAISE EXCEPTION 'operational evidence snapshot group-count mismatch: expected %, inserted %', v_groups, v_inserted_groups;
  END IF;

  RETURN jsonb_build_object(
    'status','success',
    'generation_batch_id',v_batch,
    'candidate_signal_count',v_candidates,
    'eligible_signal_count',v_eligible,
    'excluded_noncanonical_count',v_excluded_noncanonical,
    'excluded_missing_country_count',v_excluded_missing_country,
    'snapshot_group_count',v_inserted_groups,
    'risk_score_issued',false,
    'probability_issued',false,
    'recommendation_issued',false,
    'semantics','append_only_operational_evidence_inventory_v2'
  );
END;
$$;

COMMENT ON FUNCTION public.build_operational_evidence_snapshot_v1(interval) IS
  'Builds immutable country/domain evidence inventories with internally consistent run bookkeeping. Duplicate country labels per signal are deduplicated. No composite risk/probability/confidence/recommendation is issued.';
