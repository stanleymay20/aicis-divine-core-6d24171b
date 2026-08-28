-- Trust metrics truth floor v1
-- Prevent historical seeded/demo values and missing observations from being
-- presented as measured trust/compliance/certification evidence.

ALTER TABLE public.trust_metrics
  ALTER COLUMN metric_value DROP NOT NULL;

ALTER TABLE public.trust_metrics
  ADD COLUMN IF NOT EXISTS observation_status text,
  ADD COLUMN IF NOT EXISTS metric_semantics text,
  ADD COLUMN IF NOT EXISTS evidence_count integer;

ALTER TABLE public.trust_metrics
  DROP CONSTRAINT IF EXISTS trust_metrics_observation_status_check;
ALTER TABLE public.trust_metrics
  ADD CONSTRAINT trust_metrics_observation_status_check
  CHECK (observation_status IS NULL OR observation_status IN (
    'observed',
    'observed_absence',
    'unknown_no_evidence',
    'legacy_unverified'
  ));

ALTER TABLE public.trust_metrics
  DROP CONSTRAINT IF EXISTS trust_metrics_evidence_count_check;
ALTER TABLE public.trust_metrics
  ADD CONSTRAINT trust_metrics_evidence_count_check
  CHECK (evidence_count IS NULL OR evidence_count >= 0);

-- The historical policy allowed any role that could reach the table to insert
-- arbitrary public-facing "trust" values. Service-role workers bypass RLS, so
-- public insertion is unnecessary. Keep explicit authenticated-admin insertion
-- for governed manual repair while denying ordinary clients.
DROP POLICY IF EXISTS "System can insert trust metrics" ON public.trust_metrics;
DROP POLICY IF EXISTS "Admins can insert trust metrics" ON public.trust_metrics;
CREATE POLICY "Admins can insert trust metrics"
ON public.trust_metrics
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Quarantine the exact synthetic seed rows created by
-- 20251024184439_1b87a0e4-d097-4916-9e36-d6455a3c8192.sql. Their numeric
-- values were constants, not measurements. Keep the records for auditability
-- but remove the values so downstream consumers cannot mistake them for truth.
UPDATE public.trust_metrics
SET
  metric_value = NULL,
  observation_status = 'legacy_unverified',
  metric_semantics = 'historical_seed_constant_not_measurement',
  evidence_count = NULL,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'truth_floor_quarantine', true,
    'truth_floor_reason', 'historical migration inserted a fixed demonstration value without measured evidence'
  )
WHERE signature IS NULL
  AND (
    (metric_type = 'ai_trust_score' AND metric_value = 92.5 AND metadata @> '{"source":"ai_decision_logs","sample_size":1000}'::jsonb)
    OR (metric_type = 'ledger_integrity_score' AND metric_value = 99.9 AND metadata @> '{"source":"ledger_root_hashes"}'::jsonb)
    OR (metric_type = 'gdpr_compliance_score' AND metric_value = 100 AND metadata @> '{"source":"user_consent","active_consents":0}'::jsonb)
    OR (metric_type = 'sdg_progress_index' AND metric_value = 68.3 AND metadata @> '{"source":"sdg_progress","goals_tracked":17}'::jsonb)
  );

COMMENT ON COLUMN public.trust_metrics.metric_value IS
  'Nullable measured/derived observation value. NULL means the value is unknown or intentionally withheld; consult observation_status and metric_semantics.';
COMMENT ON COLUMN public.trust_metrics.observation_status IS
  'Epistemic status for the metric row. observed_absence is distinct from unknown_no_evidence.';
COMMENT ON COLUMN public.trust_metrics.metric_semantics IS
  'Plain-language semantics describing what the value represents and what it does not prove.';
COMMENT ON COLUMN public.trust_metrics.evidence_count IS
  'Number of source observations used when meaningful; NULL when not applicable or unknown.';
