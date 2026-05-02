
-- ============================================================
-- Pilot Run Guardrails: controlled pilot tracking + scaling guard
-- ============================================================

-- 1) pilot_runs: one record per controlled pilot cohort
CREATE TABLE IF NOT EXISTS public.pilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accepted_by uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  cohort_size int NOT NULL CHECK (cohort_size > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','blocked')),
  notes text,
  outcomes_logged_count int NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pilot_runs_status ON public.pilot_runs(status);
CREATE INDEX IF NOT EXISTS idx_pilot_runs_accepted_at ON public.pilot_runs(accepted_at DESC);

-- 2) pilot_run_actions: link table (action belongs to at most one run)
CREATE TABLE IF NOT EXISTS public.pilot_run_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id uuid NOT NULL REFERENCES public.pilot_runs(id) ON DELETE CASCADE,
  action_id uuid NOT NULL UNIQUE,
  outcome_logged boolean NOT NULL DEFAULT false,
  outcome_logged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pilot_run_actions_run ON public.pilot_run_actions(pilot_run_id);
CREATE INDEX IF NOT EXISTS idx_pilot_run_actions_action ON public.pilot_run_actions(action_id);

-- 3) pilot_scaling_overrides: every admin override is logged
CREATE TABLE IF NOT EXISTS public.pilot_scaling_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overridden_by uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  requested_cohort_size int NOT NULL CHECK (requested_cohort_size > 3),
  blocked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pilot_scaling_overrides_user ON public.pilot_scaling_overrides(overridden_by, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.pilot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_run_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_scaling_overrides ENABLE ROW LEVEL SECURITY;

-- Read: admins + operators
CREATE POLICY "pilot_runs_read_priv" ON public.pilot_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));

CREATE POLICY "pilot_run_actions_read_priv" ON public.pilot_run_actions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));

CREATE POLICY "pilot_scaling_overrides_read_priv" ON public.pilot_scaling_overrides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));

-- No direct writes — only via SECURITY DEFINER RPCs below.

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_pilot_runs_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_pilot_runs_updated_at ON public.pilot_runs;
CREATE TRIGGER trg_pilot_runs_updated_at BEFORE UPDATE ON public.pilot_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_pilot_runs_updated_at();

-- ============================================================
-- start_controlled_pilot_run
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_controlled_pilot_run(
  p_action_ids uuid[],
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_uid uuid := auth.uid();
  v_count int;
  v_existing int;
  v_active_run_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'operator')) THEN
    RAISE EXCEPTION 'PRIVILEGE_REQUIRED';
  END IF;
  IF p_action_ids IS NULL OR array_length(p_action_ids,1) IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIONS_PROVIDED';
  END IF;

  v_count := array_length(p_action_ids,1);

  -- Block if any of these actions are already in a run
  SELECT count(*) INTO v_existing
  FROM public.pilot_run_actions
  WHERE action_id = ANY(p_action_ids);

  IF v_existing > 0 THEN
    RAISE EXCEPTION 'ACTION_ALREADY_IN_PILOT_RUN';
  END IF;

  -- Block if there is already an active run (one cohort at a time)
  SELECT id INTO v_active_run_id FROM public.pilot_runs
  WHERE status = 'active' ORDER BY accepted_at DESC LIMIT 1;

  IF v_active_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'ACTIVE_PILOT_RUN_EXISTS:%', v_active_run_id;
  END IF;

  INSERT INTO public.pilot_runs (accepted_by, cohort_size, notes)
  VALUES (v_uid, v_count, p_notes)
  RETURNING id INTO v_run_id;

  INSERT INTO public.pilot_run_actions (pilot_run_id, action_id)
  SELECT v_run_id, unnest(p_action_ids);

  RETURN v_run_id;
END $$;

REVOKE ALL ON FUNCTION public.start_controlled_pilot_run(uuid[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.start_controlled_pilot_run(uuid[], text) TO authenticated;

-- ============================================================
-- check_pilot_scaling_guard: enforces "no >3 bulk until 3 outcomes logged"
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_pilot_scaling_guard(
  p_requested_cohort_size int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last_run public.pilot_runs%ROWTYPE;
  v_outcomes int := 0;
  v_recent_override_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'AUTH_REQUIRED');
  END IF;

  IF p_requested_cohort_size <= 3 THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'WITHIN_PILOT_LIMIT');
  END IF;

  -- Fresh, unused admin override within last hour bypasses the guard
  SELECT created_at INTO v_recent_override_at
  FROM public.pilot_scaling_overrides
  WHERE overridden_by = v_uid
    AND used_at IS NULL
    AND requested_cohort_size >= p_requested_cohort_size
    AND created_at > now() - interval '1 hour'
  ORDER BY created_at DESC LIMIT 1;

  IF v_recent_override_at IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'ADMIN_OVERRIDE_ACTIVE',
      'override_created_at', v_recent_override_at);
  END IF;

  -- Need a previous controlled pilot with >=3 outcomes logged
  SELECT * INTO v_last_run FROM public.pilot_runs
  ORDER BY accepted_at DESC LIMIT 1;

  IF v_last_run.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'NO_PRIOR_PILOT_RUN');
  END IF;

  v_outcomes := COALESCE(v_last_run.outcomes_logged_count, 0);

  IF v_outcomes >= 3 THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'PRIOR_PILOT_VALIDATED',
      'last_run_id', v_last_run.id, 'outcomes_logged', v_outcomes);
  END IF;

  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'PRIOR_PILOT_INSUFFICIENT_OUTCOMES',
    'last_run_id', v_last_run.id,
    'outcomes_logged', v_outcomes,
    'outcomes_required', 3
  );
END $$;

REVOKE ALL ON FUNCTION public.check_pilot_scaling_guard(int) FROM public;
GRANT EXECUTE ON FUNCTION public.check_pilot_scaling_guard(int) TO authenticated;

-- ============================================================
-- log_pilot_scaling_override: admin-only, with reason
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_pilot_scaling_override(
  p_reason text,
  p_requested_cohort_size int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_blocked text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'REASON_TOO_SHORT';
  END IF;
  IF p_requested_cohort_size <= 3 THEN
    RAISE EXCEPTION 'OVERRIDE_NOT_REQUIRED';
  END IF;

  v_blocked := (public.check_pilot_scaling_guard(p_requested_cohort_size)->>'reason');

  INSERT INTO public.pilot_scaling_overrides
    (overridden_by, reason, requested_cohort_size, blocked_reason)
  VALUES (v_uid, trim(p_reason), p_requested_cohort_size, v_blocked)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.log_pilot_scaling_override(text,int) FROM public;
GRANT EXECUTE ON FUNCTION public.log_pilot_scaling_override(text,int) TO authenticated;

-- ============================================================
-- Trigger: when a linked action transitions to outcome_logged,
-- update pilot_run_actions + pilot_runs counters / status.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_sync_pilot_run_outcomes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_logged int;
  v_size int;
BEGIN
  IF NEW.status = 'outcome_logged' AND COALESCE(OLD.status,'') <> 'outcome_logged' THEN
    SELECT pilot_run_id INTO v_run_id FROM public.pilot_run_actions WHERE action_id = NEW.id;
    IF v_run_id IS NOT NULL THEN
      UPDATE public.pilot_run_actions
        SET outcome_logged = true, outcome_logged_at = now()
        WHERE action_id = NEW.id AND outcome_logged = false;

      SELECT count(*) FILTER (WHERE outcome_logged), max(pr.cohort_size)
        INTO v_logged, v_size
        FROM public.pilot_run_actions pra
        JOIN public.pilot_runs pr ON pr.id = pra.pilot_run_id
        WHERE pra.pilot_run_id = v_run_id;

      UPDATE public.pilot_runs
        SET outcomes_logged_count = v_logged,
            status = CASE WHEN v_logged >= v_size THEN 'completed' ELSE status END,
            completed_at = CASE WHEN v_logged >= v_size THEN now() ELSE completed_at END
        WHERE id = v_run_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_pilot_run_outcomes ON public.risk_action_recommendations;
CREATE TRIGGER trg_sync_pilot_run_outcomes
  AFTER UPDATE OF status ON public.risk_action_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_pilot_run_outcomes();

-- ============================================================
-- View: controlled_pilot_run_status (admin/operator readable via RLS on base tables)
-- ============================================================
CREATE OR REPLACE VIEW public.controlled_pilot_run_status
WITH (security_invoker = true) AS
SELECT
  pr.id AS pilot_run_id,
  pr.accepted_by,
  pr.accepted_at,
  pr.cohort_size,
  pr.status,
  pr.outcomes_logged_count,
  pr.notes,
  pr.completed_at,
  COALESCE(
    array_agg(pra.action_id ORDER BY pra.created_at)
      FILTER (WHERE pra.action_id IS NOT NULL),
    ARRAY[]::uuid[]
  ) AS accepted_action_ids
FROM public.pilot_runs pr
LEFT JOIN public.pilot_run_actions pra ON pra.pilot_run_id = pr.id
GROUP BY pr.id;
