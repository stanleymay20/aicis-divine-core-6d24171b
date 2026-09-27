-- AICIS Strategic Research Runs v1
-- User-scoped persistence for blocker-driven research actions.
-- Keeps the original planner action immutable while allowing lifecycle/evidence updates.

CREATE TABLE IF NOT EXISTS public.strategic_research_runs_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategic_audit_hash text NOT NULL
    CHECK (strategic_audit_hash ~ '^[a-f0-9]{64}$'),
  planner_version text NOT NULL,
  workflow_version text,
  action_id text NOT NULL,
  action_kind text NOT NULL,
  title text NOT NULL,
  priority text NOT NULL
    CHECK (priority IN ('blocking','high','normal')),
  workflow_status text
    CHECK (workflow_status IS NULL OR workflow_status IN ('ready','requires_context','provider_required','manual_research','unsupported')),
  lifecycle_status text NOT NULL DEFAULT 'pending'
    CHECK (lifecycle_status IN ('pending','in_progress','blocked','resolved','stale','cancelled')),
  source_candidate_id text,
  action_snapshot jsonb NOT NULL,
  action_snapshot_hash text NOT NULL
    CHECK (action_snapshot_hash ~ '^[a-f0-9]{64}$'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  resolved_at timestamptz,
  stale_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, strategic_audit_hash, action_id),
  CHECK (jsonb_typeof(action_snapshot) = 'object'),
  CHECK (jsonb_typeof(evidence_refs) = 'array'),
  CHECK (jsonb_typeof(resolution) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_strategic_research_runs_user_status_v1
  ON public.strategic_research_runs_v1(user_id, lifecycle_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategic_research_runs_audit_v1
  ON public.strategic_research_runs_v1(strategic_audit_hash, created_at DESC);

CREATE OR REPLACE FUNCTION public.strategic_research_runs_v1_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  IF NEW.lifecycle_status = 'in_progress' AND OLD.lifecycle_status <> 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;

  IF NEW.lifecycle_status = 'resolved' AND OLD.lifecycle_status <> 'resolved' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;

  IF NEW.lifecycle_status = 'stale' AND OLD.lifecycle_status <> 'stale' AND NEW.stale_at IS NULL THEN
    NEW.stale_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.strategic_research_runs_v1_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.strategic_audit_hash IS DISTINCT FROM OLD.strategic_audit_hash
     OR NEW.planner_version IS DISTINCT FROM OLD.planner_version
     OR NEW.workflow_version IS DISTINCT FROM OLD.workflow_version
     OR NEW.action_id IS DISTINCT FROM OLD.action_id
     OR NEW.action_kind IS DISTINCT FROM OLD.action_kind
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     OR NEW.source_candidate_id IS DISTINCT FROM OLD.source_candidate_id
     OR NEW.action_snapshot IS DISTINCT FROM OLD.action_snapshot
     OR NEW.action_snapshot_hash IS DISTINCT FROM OLD.action_snapshot_hash
  THEN
    RAISE EXCEPTION 'strategic research action snapshot is immutable; create a new audited plan instead';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_strategic_research_runs_v1_guard ON public.strategic_research_runs_v1;
CREATE TRIGGER trg_strategic_research_runs_v1_guard
BEFORE UPDATE ON public.strategic_research_runs_v1
FOR EACH ROW EXECUTE FUNCTION public.strategic_research_runs_v1_guard_immutable();

DROP TRIGGER IF EXISTS trg_strategic_research_runs_v1_touch ON public.strategic_research_runs_v1;
CREATE TRIGGER trg_strategic_research_runs_v1_touch
BEFORE UPDATE ON public.strategic_research_runs_v1
FOR EACH ROW EXECUTE FUNCTION public.strategic_research_runs_v1_touch();

ALTER TABLE public.strategic_research_runs_v1 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "strategic_research_runs_select_own_v1" ON public.strategic_research_runs_v1;
CREATE POLICY "strategic_research_runs_select_own_v1"
ON public.strategic_research_runs_v1
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "strategic_research_runs_insert_own_v1" ON public.strategic_research_runs_v1;
CREATE POLICY "strategic_research_runs_insert_own_v1"
ON public.strategic_research_runs_v1
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "strategic_research_runs_update_own_v1" ON public.strategic_research_runs_v1;
CREATE POLICY "strategic_research_runs_update_own_v1"
ON public.strategic_research_runs_v1
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.strategic_research_runs_v1 FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.strategic_research_runs_v1 TO authenticated;
GRANT ALL ON TABLE public.strategic_research_runs_v1 TO service_role;

COMMENT ON TABLE public.strategic_research_runs_v1 IS
  'User-scoped blocker-driven strategic research ledger. Original planner action snapshots are immutable; lifecycle, evidence refs, and resolution may evolve under RLS.';

COMMENT ON COLUMN public.strategic_research_runs_v1.strategic_audit_hash IS
  'SHA-256 fingerprint of the pre-outcome strategic recommendation that generated this research action.';

COMMENT ON COLUMN public.strategic_research_runs_v1.action_snapshot_hash IS
  'SHA-256 fingerprint of the immutable research action snapshot stored in action_snapshot.';
