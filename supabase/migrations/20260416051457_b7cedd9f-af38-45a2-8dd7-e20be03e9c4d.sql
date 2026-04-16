
-- Prospective forecast evaluation: locked, immutable pipeline
CREATE TABLE public.forecast_prospective_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid,
  domain text NOT NULL,
  iso3 text,
  model_version text NOT NULL,
  horizon_days int NOT NULL,
  predicted_value numeric NOT NULL,
  predicted_direction text NOT NULL,
  predicted_at timestamptz NOT NULL DEFAULT now(),
  realization_due_at timestamptz NOT NULL,
  realized_value numeric,
  realized_direction text,
  realized_at timestamptz,
  direction_hit boolean,
  absolute_error numeric,
  evaluation_locked boolean NOT NULL DEFAULT false,
  evaluation_window text NOT NULL DEFAULT '30d',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_horizon CHECK (horizon_days > 0),
  CONSTRAINT valid_direction CHECK (predicted_direction IN ('up','down','stable'))
);

ALTER TABLE public.forecast_prospective_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view prospective evaluations"
  ON public.forecast_prospective_evaluations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role inserts prospective evaluations"
  ON public.forecast_prospective_evaluations FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role updates prospective evaluations"
  ON public.forecast_prospective_evaluations FOR UPDATE TO service_role 
  USING (evaluation_locked = false);

-- Immutability: once realized, no changes allowed
CREATE OR REPLACE FUNCTION public.prevent_prospective_eval_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF OLD.evaluation_locked = true THEN
    RAISE EXCEPTION 'Prospective evaluation is locked — no mutations allowed after realization';
  END IF;
  IF NEW.realized_value IS NOT NULL AND OLD.realized_value IS NOT NULL THEN
    RAISE EXCEPTION 'Realized outcome already recorded — cannot overwrite';
  END IF;
  IF NEW.realized_value IS NOT NULL THEN
    NEW.evaluation_locked := true;
    NEW.realized_at := COALESCE(NEW.realized_at, now());
    NEW.direction_hit := (NEW.realized_direction = OLD.predicted_direction);
    NEW.absolute_error := ABS(NEW.realized_value - OLD.predicted_value);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_prospective_eval_immutability
BEFORE UPDATE ON public.forecast_prospective_evaluations
FOR EACH ROW EXECUTE FUNCTION public.prevent_prospective_eval_mutation();

-- Block deletes entirely
CREATE OR REPLACE FUNCTION public.prevent_prospective_eval_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'forecast_prospective_evaluations is append-only — DELETE is prohibited';
END;
$$;

CREATE TRIGGER block_prospective_eval_delete
BEFORE DELETE ON public.forecast_prospective_evaluations
FOR EACH ROW EXECUTE FUNCTION public.prevent_prospective_eval_delete();

-- Truth harness version registry
CREATE TABLE public.truth_harness_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_tag text NOT NULL UNIQUE,
  scoring_formula jsonb NOT NULL,
  sampling_strategy jsonb NOT NULL,
  backfilled_layers text[] DEFAULT '{}',
  structural_fixes text[] DEFAULT '{}',
  measurement_fixes text[] DEFAULT '{}',
  notes text,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.truth_harness_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view harness versions"
  ON public.truth_harness_versions FOR SELECT TO authenticated USING (true);

-- Indexes
CREATE INDEX idx_prospective_eval_domain ON public.forecast_prospective_evaluations(domain);
CREATE INDEX idx_prospective_eval_realization ON public.forecast_prospective_evaluations(realization_due_at);
CREATE INDEX idx_prospective_eval_model ON public.forecast_prospective_evaluations(model_version);
CREATE INDEX idx_prospective_eval_locked ON public.forecast_prospective_evaluations(evaluation_locked);
