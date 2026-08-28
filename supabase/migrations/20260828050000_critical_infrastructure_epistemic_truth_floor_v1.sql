-- AICIS critical-infrastructure epistemic truth floor v1
--
-- Asset identity is not asset health. Missing operational evidence must never become
-- "operational", and an absent vulnerability/resilience assessment must never become 0.
-- Historical values are retained in reported_* audit fields while canonical fields
-- are withheld until their semantics and evidence are explicit.

ALTER TABLE public.critical_infrastructure_assets
  ALTER COLUMN operational_status DROP DEFAULT,
  ALTER COLUMN strategic_importance DROP DEFAULT,
  ALTER COLUMN vulnerability_score DROP DEFAULT,
  ALTER COLUMN resilience_score DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS reported_operational_status text,
  ADD COLUMN IF NOT EXISTS operational_status_semantics text,
  ADD COLUMN IF NOT EXISTS operational_status_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS operational_status_source_record_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reported_strategic_importance numeric,
  ADD COLUMN IF NOT EXISTS strategic_importance_semantics text,
  ADD COLUMN IF NOT EXISTS reported_vulnerability_score numeric,
  ADD COLUMN IF NOT EXISTS vulnerability_score_semantics text,
  ADD COLUMN IF NOT EXISTS vulnerability_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS vulnerability_source_record_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reported_resilience_score numeric,
  ADD COLUMN IF NOT EXISTS resilience_score_semantics text,
  ADD COLUMN IF NOT EXISTS resilience_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resilience_source_record_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dependency_graph_semantics text,
  ADD COLUMN IF NOT EXISTS registry_evidence_status text NOT NULL DEFAULT 'unknown'
    CHECK (registry_evidence_status IN ('unknown','identity_only','partial','supported'));

-- The original schema supplied these defaults itself. Therefore historical values
-- equal to those defaults cannot be distinguished from measured values. Preserve
-- them for audit and withhold them from canonical analytical use.
UPDATE public.critical_infrastructure_assets
SET
  reported_operational_status = COALESCE(reported_operational_status, operational_status),
  operational_status = NULL,
  operational_status_semantics = COALESCE(
    operational_status_semantics,
    'legacy_operational_status_semantics_unverified'
  ),
  reported_strategic_importance = COALESCE(reported_strategic_importance, strategic_importance),
  strategic_importance = NULL,
  strategic_importance_semantics = COALESCE(
    strategic_importance_semantics,
    'legacy_strategic_importance_semantics_unverified'
  ),
  reported_vulnerability_score = COALESCE(reported_vulnerability_score, vulnerability_score),
  vulnerability_score = NULL,
  vulnerability_score_semantics = COALESCE(
    vulnerability_score_semantics,
    'legacy_vulnerability_score_semantics_unverified'
  ),
  reported_resilience_score = COALESCE(reported_resilience_score, resilience_score),
  resilience_score = NULL,
  resilience_score_semantics = COALESCE(
    resilience_score_semantics,
    'legacy_resilience_score_semantics_unverified'
  ),
  dependency_graph_semantics = COALESCE(
    dependency_graph_semantics,
    CASE
      WHEN dependency_graph IS NULL OR dependency_graph = '[]'::jsonb THEN 'no_dependency_evidence_recorded'
      ELSE 'legacy_dependency_graph_semantics_unverified'
    END
  ),
  registry_evidence_status = CASE
    WHEN registry_evidence_status = 'supported' THEN 'partial'
    ELSE COALESCE(registry_evidence_status, 'identity_only')
  END;

CREATE OR REPLACE FUNCTION public.aicis_critical_asset_semantics_unusable_v1(p_semantics text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_semantics IS NULL
    OR btrim(p_semantics) = ''
    OR lower(p_semantics) LIKE '%legacy%'
    OR lower(p_semantics) LIKE '%unknown%'
    OR lower(p_semantics) LIKE '%unverified%'
    OR lower(p_semantics) LIKE '%unspecified%'
    OR lower(p_semantics) LIKE '%unlabeled%'
    OR lower(p_semantics) LIKE '%withheld%';
$$;

REVOKE ALL ON FUNCTION public.aicis_critical_asset_semantics_unusable_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aicis_critical_asset_semantics_unusable_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_critical_infrastructure_epistemics_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.operational_status IS NOT NULL THEN
    IF public.aicis_critical_asset_semantics_unusable_v1(NEW.operational_status_semantics)
       OR NEW.operational_status_observed_at IS NULL
       OR cardinality(NEW.operational_status_source_record_keys) = 0 THEN
      NEW.reported_operational_status := COALESCE(NEW.reported_operational_status, NEW.operational_status);
      NEW.operational_status := NULL;
      NEW.operational_status_semantics := 'withheld_without_status_evidence_contract';
    END IF;
  END IF;

  IF NEW.strategic_importance IS NOT NULL
     AND public.aicis_critical_asset_semantics_unusable_v1(NEW.strategic_importance_semantics) THEN
    NEW.reported_strategic_importance := COALESCE(NEW.reported_strategic_importance, NEW.strategic_importance);
    NEW.strategic_importance := NULL;
    NEW.strategic_importance_semantics := 'withheld_unlabeled_strategic_importance';
  END IF;

  IF NEW.vulnerability_score IS NOT NULL THEN
    IF public.aicis_critical_asset_semantics_unusable_v1(NEW.vulnerability_score_semantics)
       OR NEW.vulnerability_assessed_at IS NULL
       OR cardinality(NEW.vulnerability_source_record_keys) = 0 THEN
      NEW.reported_vulnerability_score := COALESCE(NEW.reported_vulnerability_score, NEW.vulnerability_score);
      NEW.vulnerability_score := NULL;
      NEW.vulnerability_score_semantics := 'withheld_without_vulnerability_evidence_contract';
    END IF;
  END IF;

  IF NEW.resilience_score IS NOT NULL THEN
    IF public.aicis_critical_asset_semantics_unusable_v1(NEW.resilience_score_semantics)
       OR NEW.resilience_assessed_at IS NULL
       OR cardinality(NEW.resilience_source_record_keys) = 0 THEN
      NEW.reported_resilience_score := COALESCE(NEW.reported_resilience_score, NEW.resilience_score);
      NEW.resilience_score := NULL;
      NEW.resilience_score_semantics := 'withheld_without_resilience_evidence_contract';
    END IF;
  END IF;

  IF NEW.dependency_graph IS NOT NULL
     AND NEW.dependency_graph <> '[]'::jsonb
     AND public.aicis_critical_asset_semantics_unusable_v1(NEW.dependency_graph_semantics) THEN
    NEW.dependency_graph_semantics := 'legacy_or_unlabeled_dependency_graph_not_verified';
  END IF;

  NEW.registry_evidence_status := CASE
    WHEN NEW.operational_status IS NOT NULL
      AND NEW.vulnerability_score IS NOT NULL
      AND NEW.resilience_score IS NOT NULL THEN 'supported'
    WHEN NEW.operational_status IS NOT NULL
      OR NEW.vulnerability_score IS NOT NULL
      OR NEW.resilience_score IS NOT NULL
      OR NEW.strategic_importance IS NOT NULL THEN 'partial'
    ELSE 'identity_only'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_critical_infrastructure_epistemics_v1
ON public.critical_infrastructure_assets;
CREATE TRIGGER trg_guard_critical_infrastructure_epistemics_v1
BEFORE INSERT OR UPDATE ON public.critical_infrastructure_assets
FOR EACH ROW EXECUTE FUNCTION public.guard_critical_infrastructure_epistemics_v1();

REVOKE ALL ON FUNCTION public.guard_critical_infrastructure_epistemics_v1() FROM PUBLIC;

ALTER TABLE public.critical_infrastructure_assets
  ADD CONSTRAINT critical_asset_vulnerability_score_range_v1
    CHECK (vulnerability_score IS NULL OR vulnerability_score BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT critical_asset_resilience_score_range_v1
    CHECK (resilience_score IS NULL OR resilience_score BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT critical_asset_strategic_importance_range_v1
    CHECK (strategic_importance IS NULL OR strategic_importance BETWEEN 0 AND 100) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_critical_assets_evidence_status_v1
ON public.critical_infrastructure_assets(registry_evidence_status, asset_type, country_code);

COMMENT ON COLUMN public.critical_infrastructure_assets.operational_status IS
  'Nullable observed/reported operational state. NULL means unknown; absence of evidence never implies operational.';
COMMENT ON COLUMN public.critical_infrastructure_assets.operational_status_observed_at IS
  'Source/evidence observation time for operational_status. It is not registry ingestion time.';
COMMENT ON COLUMN public.critical_infrastructure_assets.vulnerability_score IS
  'Nullable governed vulnerability assessment. Zero is valid only when explicitly evidenced; NULL means not established.';
COMMENT ON COLUMN public.critical_infrastructure_assets.resilience_score IS
  'Nullable governed resilience assessment. Zero is valid only when explicitly evidenced; NULL means not established.';
COMMENT ON COLUMN public.critical_infrastructure_assets.strategic_importance IS
  'Nullable operator/analytical prioritization score; inspect strategic_importance_semantics. It is not probability or asset health.';
COMMENT ON COLUMN public.critical_infrastructure_assets.registry_evidence_status IS
  'Coverage state for canonical asset-health evidence. identity_only means the registry knows the asset but not its operational health.';
