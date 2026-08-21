-- Make PNS disaster-recovery certification evidence-based instead of permanently failing.
-- This does not fabricate a passing drill: Gate Q only passes after a verified successful restore drill.

CREATE TABLE IF NOT EXISTS public.disaster_recovery_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','cancelled')),
  backup_reference text,
  restore_target text,
  restored_record_count bigint,
  integrity_check_passed boolean NOT NULL DEFAULT false,
  rto_minutes numeric,
  rpo_minutes numeric,
  verified_at timestamptz,
  verifier text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disaster_recovery_drills_verified_pass_check CHECK (
    verified_at IS NULL OR (status = 'passed' AND completed_at IS NOT NULL AND integrity_check_passed = true)
  )
);

CREATE INDEX IF NOT EXISTS idx_disaster_recovery_drills_verified_at
  ON public.disaster_recovery_drills (verified_at DESC)
  WHERE verified_at IS NOT NULL;

ALTER TABLE public.disaster_recovery_drills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.disaster_recovery_drills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.disaster_recovery_drills TO service_role;

COMMENT ON TABLE public.disaster_recovery_drills IS
  'Evidence ledger for real backup/restore drills. A PNS DR gate may pass only from a recent verified successful drill.';

-- Preserve the current full certification implementation as the base scorer once.
DO $$
BEGIN
  IF to_regprocedure('public.compute_pns_certification_legacy()') IS NULL THEN
    ALTER FUNCTION public.compute_pns_certification() RENAME TO compute_pns_certification_legacy;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.compute_pns_certification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_result jsonb;
  revised_gates jsonb;
  q_gate jsonb;
  drill_count int := 0;
  latest_verified timestamptz;
  total_gates int;
  passed_gates int;
  revised_score numeric;
  run_uuid uuid;
BEGIN
  -- Run the complete existing certification first. It records the run and all other gates.
  base_result := public.compute_pns_certification_legacy();
  run_uuid := (base_result->>'run_id')::uuid;

  SELECT count(*), max(verified_at)
    INTO drill_count, latest_verified
    FROM public.disaster_recovery_drills
   WHERE status = 'passed'
     AND completed_at IS NOT NULL
     AND integrity_check_passed = true
     AND verified_at IS NOT NULL
     AND verified_at > now() - interval '90 days';

  q_gate := jsonb_build_object(
    'gate', 'Q_disaster_recovery',
    'metric', 'verified successful restore drill in last 90d',
    'target', 1,
    'value', drill_count,
    'status', CASE WHEN drill_count >= 1 THEN 'PASS' ELSE 'FAIL' END,
    'evidence', CASE
      WHEN drill_count >= 1 THEN
        'disaster_recovery_drills: ' || drill_count || ' verified passing drill(s); latest=' || latest_verified::text
      ELSE
        'No verified passing restore drill in disaster_recovery_drills during the last 90 days'
    END
  );

  SELECT jsonb_agg(
           CASE WHEN gate->>'gate' = 'Q_disaster_recovery' THEN q_gate ELSE gate END
           ORDER BY ord
         )
    INTO revised_gates
    FROM jsonb_array_elements(base_result->'gates') WITH ORDINALITY AS x(gate, ord);

  SELECT count(*), count(*) FILTER (WHERE gate->>'status' = 'PASS')
    INTO total_gates, passed_gates
    FROM jsonb_array_elements(revised_gates) AS x(gate);

  revised_score := round(100.0 * passed_gates / NULLIF(total_gates, 0), 2);

  UPDATE public.pns_certification_runs
     SET overall_score = revised_score,
         gates_total = total_gates,
         gates_passed = passed_gates,
         gates = revised_gates
   WHERE id = run_uuid;

  RETURN jsonb_build_object(
    'run_id', run_uuid,
    'overall_score', revised_score,
    'gates_total', total_gates,
    'gates_passed', passed_gates,
    'gates', revised_gates
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_pns_certification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_pns_certification() TO service_role, postgres;
