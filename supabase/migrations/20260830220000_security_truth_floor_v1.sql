-- AICIS Security Truth Floor v1
--
-- Purpose:
--   Make security readiness evidence-derived rather than declaration-derived.
--   A control is not considered secure because somebody marked it implemented.
--
-- This migration is additive. It does NOT deploy to any live Supabase project,
-- enable writers, activate cron, grant new human privileges, or assert NIST
-- compliance. Framework mappings are control references, not certification.

CREATE TABLE IF NOT EXISTS public.aicis_security_control_catalog (
  control_key text PRIMARY KEY,
  framework text NOT NULL,
  framework_control_id text NOT NULL,
  title text NOT NULL,
  control_family text NOT NULL,
  criticality text NOT NULL CHECK (criticality IN ('p0','p1','p2','p3')),
  required_for_production boolean NOT NULL DEFAULT false,
  applicability text NOT NULL DEFAULT 'applicable'
    CHECK (applicability IN ('applicable','not_applicable','pending_scope')),
  evidence_policy_version text NOT NULL DEFAULT 'security-truth-floor-v1',
  notes text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (framework, framework_control_id)
);

CREATE TABLE IF NOT EXISTS public.aicis_security_control_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_key text NOT NULL REFERENCES public.aicis_security_control_catalog(control_key) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('repository','ci','development','staging','production','independent')),
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'implementation_artifact',
    'static_test',
    'behavioral_test',
    'runtime_test',
    'runtime_event',
    'independent_assessment'
  )),
  result text NOT NULL CHECK (result IN ('pass','fail','unknown')),
  artifact_ref text,
  artifact_sha256 text,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz,
  verifier_identity text NOT NULL,
  verifier_method text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at IS NULL OR expires_at > observed_at),
  CHECK (btrim(verifier_identity) <> ''),
  CHECK (btrim(verifier_method) <> '')
);

CREATE INDEX IF NOT EXISTS idx_aicis_security_evidence_control_time
  ON public.aicis_security_control_evidence(control_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_aicis_security_evidence_environment
  ON public.aicis_security_control_evidence(environment, evidence_kind, observed_at DESC);

-- Evidence is append-only. Corrections require a new evidence row so an
-- incorrect or compromised prior assertion remains visible to auditors.
CREATE OR REPLACE FUNCTION public.aicis_security_evidence_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AICIS security evidence is append-only; append a superseding evidence record';
END;
$$;

REVOKE ALL ON FUNCTION public.aicis_security_evidence_immutable_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aicis_security_evidence_immutable_v1()
  TO service_role;

DROP TRIGGER IF EXISTS trg_aicis_security_evidence_no_update
  ON public.aicis_security_control_evidence;
CREATE TRIGGER trg_aicis_security_evidence_no_update
BEFORE UPDATE OR DELETE ON public.aicis_security_control_evidence
FOR EACH ROW EXECUTE FUNCTION public.aicis_security_evidence_immutable_v1();

-- Human assessment is useful context, but never the authority for readiness.
CREATE TABLE IF NOT EXISTS public.aicis_security_control_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_key text NOT NULL REFERENCES public.aicis_security_control_catalog(control_key) ON DELETE RESTRICT,
  declared_status text NOT NULL CHECK (declared_status IN (
    'unimplemented',
    'implemented_unverified',
    'statically_verified',
    'behaviorally_verified',
    'runtime_verified',
    'degraded',
    'failed',
    'not_applicable'
  )),
  assessed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  assessor_identity text NOT NULL,
  residual_risk text,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Canonical evidence-derived state. It fails closed:
-- * no current evidence = unverified
-- * any non-expired failure = failed
-- * an implementation artifact alone never earns verified status
-- * static checks never become behavioral/runtime proof
-- * production readiness requires behavioral or runtime proof.
CREATE OR REPLACE VIEW public.aicis_security_control_effective_state_v1
WITH (security_invoker = true)
AS
WITH current_evidence AS (
  SELECT e.*
  FROM public.aicis_security_control_evidence e
  WHERE e.expires_at IS NULL OR e.expires_at > clock_timestamp()
), aggregate_evidence AS (
  SELECT
    c.control_key,
    bool_or(e.result = 'fail') FILTER (WHERE e.id IS NOT NULL) AS has_failure,
    bool_or(e.result = 'pass' AND e.evidence_kind = 'implementation_artifact') AS has_implementation,
    bool_or(e.result = 'pass' AND e.evidence_kind = 'static_test') AS has_static,
    bool_or(e.result = 'pass' AND e.evidence_kind = 'behavioral_test') AS has_behavioral,
    bool_or(e.result = 'pass' AND e.evidence_kind IN ('runtime_test','runtime_event')) AS has_runtime,
    bool_or(e.result = 'pass' AND e.evidence_kind = 'independent_assessment') AS has_independent,
    count(e.id) FILTER (WHERE e.result = 'pass') AS passing_evidence_count,
    max(e.observed_at) AS latest_evidence_at
  FROM public.aicis_security_control_catalog c
  LEFT JOIN current_evidence e ON e.control_key = c.control_key
  GROUP BY c.control_key
)
SELECT
  c.control_key,
  c.framework,
  c.framework_control_id,
  c.title,
  c.control_family,
  c.criticality,
  c.required_for_production,
  c.applicability,
  CASE
    WHEN c.applicability = 'not_applicable' THEN 'not_applicable'
    WHEN coalesce(a.has_failure, false) THEN 'failed'
    WHEN coalesce(a.has_independent, false) AND coalesce(a.has_runtime, false) THEN 'runtime_verified'
    WHEN coalesce(a.has_runtime, false) AND coalesce(a.has_behavioral, false) THEN 'runtime_verified'
    WHEN coalesce(a.has_behavioral, false) THEN 'behaviorally_verified'
    WHEN coalesce(a.has_static, false) THEN 'statically_verified'
    WHEN coalesce(a.has_implementation, false) THEN 'implemented_unverified'
    ELSE 'unverified'
  END AS effective_status,
  coalesce(a.passing_evidence_count, 0) AS passing_evidence_count,
  a.latest_evidence_at
FROM public.aicis_security_control_catalog c
LEFT JOIN aggregate_evidence a ON a.control_key = c.control_key;

REVOKE ALL ON public.aicis_security_control_effective_state_v1 FROM PUBLIC, anon;
GRANT SELECT ON public.aicis_security_control_effective_state_v1 TO authenticated, service_role;

-- Production readiness is intentionally strict. A required control contributes
-- PASS only with behavioral/runtime proof; static source inspection alone is
-- insufficient. Unknown controls keep readiness false.
CREATE OR REPLACE VIEW public.aicis_security_production_readiness_v1
WITH (security_invoker = true)
AS
SELECT
  count(*) FILTER (WHERE required_for_production AND applicability = 'applicable') AS required_controls,
  count(*) FILTER (
    WHERE required_for_production
      AND applicability = 'applicable'
      AND effective_status IN ('behaviorally_verified','runtime_verified')
  ) AS verified_required_controls,
  count(*) FILTER (
    WHERE required_for_production
      AND applicability = 'applicable'
      AND effective_status = 'failed'
  ) AS failed_required_controls,
  count(*) FILTER (
    WHERE required_for_production
      AND applicability = 'applicable'
      AND effective_status NOT IN ('behaviorally_verified','runtime_verified','failed')
  ) AS unverified_required_controls,
  CASE
    WHEN count(*) FILTER (WHERE required_for_production AND applicability = 'applicable') = 0 THEN false
    WHEN count(*) FILTER (
      WHERE required_for_production
        AND applicability = 'applicable'
        AND effective_status NOT IN ('behaviorally_verified','runtime_verified')
    ) > 0 THEN false
    ELSE true
  END AS production_security_ready,
  'security-truth-floor-v1'::text AS readiness_policy
FROM public.aicis_security_control_effective_state_v1;

REVOKE ALL ON public.aicis_security_production_readiness_v1 FROM PUBLIC, anon;
GRANT SELECT ON public.aicis_security_production_readiness_v1 TO authenticated, service_role;

-- Initial high-priority catalog mapped to NIST SP 800-53 Rev. 5. These rows do
-- NOT assert implementation or compliance. No PASS evidence is seeded.
INSERT INTO public.aicis_security_control_catalog
  (control_key, framework, framework_control_id, title, control_family, criticality, required_for_production, notes)
VALUES
  ('nist-ac-5',  'NIST-SP-800-53r5', 'AC-5',  'Separation of Duties', 'Access Control', 'p0', true, 'Separate high-consequence verification, resolution, promotion, security and deployment authorities.'),
  ('nist-ac-6',  'NIST-SP-800-53r5', 'AC-6',  'Least Privilege', 'Access Control', 'p0', true, 'Users and service processes receive only capabilities necessary for assigned tasks.'),
  ('nist-ia-2',  'NIST-SP-800-53r5', 'IA-2',  'Identification and Authentication', 'Identification and Authentication', 'p0', true, 'Unique identity and strong authentication for organizational users; privileged MFA is expected.'),
  ('nist-au-9',  'NIST-SP-800-53r5', 'AU-9',  'Protection of Audit Information', 'Audit and Accountability', 'p0', true, 'Audit evidence must resist modification by operators and survive compromise of the audited workload.'),
  ('nist-ir-4',  'NIST-SP-800-53r5', 'IR-4',  'Incident Handling', 'Incident Response', 'p0', true, 'Preparation, detection, analysis, containment, eradication and recovery must be exercised.'),
  ('nist-cp-9',  'NIST-SP-800-53r5', 'CP-9',  'System Backup', 'Contingency Planning', 'p0', true, 'Backups are not trusted until integrity and restoration are tested.'),
  ('nist-ra-5',  'NIST-SP-800-53r5', 'RA-5',  'Vulnerability Monitoring and Scanning', 'Risk Assessment', 'p0', true, 'Continuous vulnerability discovery across application, dependency, database and infrastructure surfaces.'),
  ('nist-sc-7',  'NIST-SP-800-53r5', 'SC-7',  'Boundary Protection', 'System and Communications Protection', 'p0', true, 'Public, intelligence and privileged control planes require explicit managed trust boundaries.'),
  ('nist-si-2',  'NIST-SP-800-53r5', 'SI-2',  'Flaw Remediation', 'System and Information Integrity', 'p1', true, 'Security flaws require governed remediation and patch verification.'),
  ('nist-si-3',  'NIST-SP-800-53r5', 'SI-3',  'Malicious Code Protection', 'System and Information Integrity', 'p1', true, 'External files and data ingestion paths require malware/untrusted-content defenses.'),
  ('nist-si-4',  'NIST-SP-800-53r5', 'SI-4',  'System Monitoring', 'System and Information Integrity', 'p0', true, 'Security telemetry must detect compromise indicators and support alerting/response.'),
  ('nist-sr-3',  'NIST-SP-800-53r5', 'SR-3',  'Supply Chain Controls and Processes', 'Supply Chain Risk Management', 'p1', true, 'Dependencies, build actions and external providers require controlled provenance and review.'),
  ('nist-sa-11', 'NIST-SP-800-53r5', 'SA-11', 'Developer Testing and Evaluation', 'System and Services Acquisition', 'p1', true, 'Security testing must be part of the software development lifecycle.')
ON CONFLICT (control_key) DO NOTHING;

ALTER TABLE public.aicis_security_control_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_security_control_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_security_control_assessments ENABLE ROW LEVEL SECURITY;

-- Do not create broad authenticated write policies here. The future security
-- control-plane writer must be separately governed and behaviorally tested.
GRANT SELECT ON public.aicis_security_control_catalog TO authenticated, service_role;
GRANT SELECT ON public.aicis_security_control_evidence TO authenticated, service_role;
GRANT SELECT ON public.aicis_security_control_assessments TO authenticated, service_role;
GRANT INSERT ON public.aicis_security_control_evidence, public.aicis_security_control_assessments TO service_role;

COMMENT ON VIEW public.aicis_security_production_readiness_v1 IS
  'Fail-closed AICIS security readiness. Security is ready only when every applicable required control has current behavioral or runtime evidence and no current failure.';
