-- AICIS Governed Operational Evidence Snapshot v1
--
-- Replacement substrate for legacy operational-risk/digital-twin scoring.
-- This layer inventories evidence; it does NOT issue a composite risk score,
-- probability, confidence, recommendation, or causal claim.

CREATE OR REPLACE FUNCTION public.aicis_semantics_usable_v1(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_semantics IS NOT NULL
    AND btrim(p_semantics) <> ''
    AND lower(p_semantics) NOT LIKE '%legacy%'
    AND lower(p_semantics) NOT LIKE '%unknown%'
    AND lower(p_semantics) NOT LIKE '%unverified%'
    AND lower(p_semantics) NOT LIKE '%unspecified%'
    AND lower(p_semantics) NOT LIKE '%unlabeled%'
    AND lower(p_semantics) NOT LIKE '%withheld%'
    AND lower(p_semantics) NOT LIKE '%not_quantified%';
$$;

REVOKE ALL ON FUNCTION public.aicis_semantics_usable_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_semantics_usable_v1(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.operational_evidence_snapshot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_batch_id uuid NOT NULL UNIQUE,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  candidate_signal_count integer NOT NULL CHECK (candidate_signal_count >= 0),
  eligible_signal_count integer NOT NULL CHECK (eligible_signal_count >= 0),
  excluded_noncanonical_count integer NOT NULL CHECK (excluded_noncanonical_count >= 0),
  excluded_missing_country_count integer NOT NULL CHECK (excluded_missing_country_count >= 0),
  snapshot_group_count integer NOT NULL CHECK (snapshot_group_count >= 0),
  run_semantics text NOT NULL DEFAULT 'evidence_inventory_generation_no_risk_score_issued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.operational_evidence_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_batch_id uuid NOT NULL REFERENCES public.operational_evidence_snapshot_runs(generation_batch_id) ON DELETE RESTRICT,
  country_iso3 text NOT NULL,
  domain text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  source_signal_count integer NOT NULL CHECK (source_signal_count >= 1),
  governed_impact_count integer NOT NULL CHECK (governed_impact_count >= 0),
  governed_urgency_count integer NOT NULL CHECK (governed_urgency_count >= 0),
  governed_confidence_count integer NOT NULL CHECK (governed_confidence_count >= 0),
  independently_assessed_signal_count integer NOT NULL CHECK (independently_assessed_signal_count >= 0),
  independently_corroborated_signal_count integer NOT NULL CHECK (independently_corroborated_signal_count >= 0),
  source_published_time_count integer NOT NULL CHECK (source_published_time_count >= 0),
  occurrence_time_count integer NOT NULL CHECK (occurrence_time_count >= 0),
  latest_record_update_at timestamptz,
  latest_source_published_at timestamptz,
  latest_occurrence_at timestamptz,
  signal_ids uuid[] NOT NULL,
  evidence_inventory jsonb NOT NULL DEFAULT '[]'::jsonb,
  independence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_coverage_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  withheld_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_status text NOT NULL,
  snapshot_semantics text NOT NULL DEFAULT 'descriptive_evidence_inventory_no_composite_risk_or_probability',
  score_aggregation_semantics text NOT NULL DEFAULT 'no_cross_signal_score_aggregation_issued',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(generation_batch_id, country_iso3, domain)
);

CREATE INDEX IF NOT EXISTS idx_operational_evidence_snapshots_subject
  ON public.operational_evidence_snapshots(country_iso3, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_evidence_snapshots_batch
  ON public.operational_evidence_snapshots(generation_batch_id, country_iso3, domain);

ALTER TABLE public.operational_evidence_snapshot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_evidence_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read operational evidence snapshot runs"
  ON public.operational_evidence_snapshot_runs;
CREATE POLICY "Authenticated read operational evidence snapshot runs"
  ON public.operational_evidence_snapshot_runs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated read operational evidence snapshots"
  ON public.operational_evidence_snapshots;
CREATE POLICY "Authenticated read operational evidence snapshots"
  ON public.operational_evidence_snapshots
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role writes operational evidence snapshot runs"
  ON public.operational_evidence_snapshot_runs;
CREATE POLICY "Service role writes operational evidence snapshot runs"
  ON public.operational_evidence_snapshot_runs
  FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role writes operational evidence snapshots"
  ON public.operational_evidence_snapshots;
CREATE POLICY "Service role writes operational evidence snapshots"
  ON public.operational_evidence_snapshots
  FOR INSERT TO service_role
  WITH CHECK (true);

GRANT SELECT ON public.operational_evidence_snapshot_runs TO authenticated;
GRANT SELECT ON public.operational_evidence_snapshots TO authenticated;
GRANT SELECT, INSERT ON public.operational_evidence_snapshot_runs TO service_role;
GRANT SELECT, INSERT ON public.operational_evidence_snapshots TO service_role;

DROP TRIGGER IF EXISTS trg_operational_evidence_snapshot_runs_immutable
  ON public.operational_evidence_snapshot_runs;
CREATE TRIGGER trg_operational_evidence_snapshot_runs_immutable
  BEFORE UPDATE OR DELETE ON public.operational_evidence_snapshot_runs
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

DROP TRIGGER IF EXISTS trg_operational_evidence_snapshots_immutable
  ON public.operational_evidence_snapshots;
CREATE TRIGGER trg_operational_evidence_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.operational_evidence_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

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
BEGIN
  IF p_window IS NULL OR p_window <= interval '0 seconds' THEN
    RAISE EXCEPTION 'p_window must be positive';
  END IF;

  SELECT COUNT(*)
  INTO v_candidates
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= v_window_start
    AND COALESCE(gs.ingested_at, gs.created_at) <= v_window_end;

  SELECT COUNT(*)
  INTO v_excluded_noncanonical
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= v_window_start
    AND COALESCE(gs.ingested_at, gs.created_at) <= v_window_end
    AND gs.canonical_event_status IS DISTINCT FROM 'canonical';

  SELECT COUNT(*)
  INTO v_excluded_missing_country
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= v_window_start
    AND COALESCE(gs.ingested_at, gs.created_at) <= v_window_end
    AND gs.canonical_event_status = 'canonical'
    AND (gs.affected_countries IS NULL OR cardinality(gs.affected_countries) = 0);

  SELECT COUNT(*)
  INTO v_eligible
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at, gs.created_at) >= v_window_start
    AND COALESCE(gs.ingested_at, gs.created_at) <= v_window_end
    AND gs.canonical_event_status = 'canonical'
    AND gs.affected_countries IS NOT NULL
    AND cardinality(gs.affected_countries) > 0;

  INSERT INTO public.operational_evidence_snapshot_runs(
    generation_batch_id,window_start,window_end,
    candidate_signal_count,eligible_signal_count,
    excluded_noncanonical_count,excluded_missing_country_count,
    snapshot_group_count
  ) VALUES (
    v_batch,v_window_start,v_window_end,
    v_candidates,v_eligible,
    v_excluded_noncanonical,v_excluded_missing_country,
    0
  );

  WITH eligible AS (
    SELECT
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
    WHERE COALESCE(gs.ingested_at, gs.created_at) >= v_window_start
      AND COALESCE(gs.ingested_at, gs.created_at) <= v_window_end
      AND gs.canonical_event_status = 'canonical'
      AND gs.affected_countries IS NOT NULL
      AND cardinality(gs.affected_countries) > 0
      AND country_code IS NOT NULL
      AND btrim(country_code) <> ''
      AND gs.category IS NOT NULL
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
      MAX(latest_update_at) AS latest_record_update_at,
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
          'latest_update_at',latest_update_at,
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

  GET DIAGNOSTICS v_groups = ROW_COUNT;

  -- Append-only run record cannot be updated; record completion as a separate
  -- immutable completion row would duplicate the batch. Instead snapshot_group_count
  -- is calculated before run insert on future versions. v1 returns the observed
  -- inserted count explicitly and leaves run.snapshot_group_count=0 with semantics
  -- documenting that limitation.
  RETURN jsonb_build_object(
    'status','success',
    'generation_batch_id',v_batch,
    'candidate_signal_count',v_candidates,
    'eligible_signal_count',v_eligible,
    'excluded_noncanonical_count',v_excluded_noncanonical,
    'excluded_missing_country_count',v_excluded_missing_country,
    'snapshot_group_count',v_groups,
    'risk_score_issued',false,
    'probability_issued',false,
    'recommendation_issued',false,
    'semantics','append_only_operational_evidence_inventory_v1'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_operational_evidence_snapshot_v1(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_operational_evidence_snapshot_v1(interval)
  TO service_role;

COMMENT ON TABLE public.operational_evidence_snapshots IS
  'Append-only country/domain evidence inventories for future governed operational models. These snapshots deliberately issue no composite risk, probability, confidence, causal claim, or recommendation.';
COMMENT ON FUNCTION public.build_operational_evidence_snapshot_v1(interval) IS
  'Builds append-only semantic coverage/evidence inventories from canonical global signals with explicit countries. Missing country is excluded rather than mapped to GLOBAL; no cross-signal composite score is computed.';
