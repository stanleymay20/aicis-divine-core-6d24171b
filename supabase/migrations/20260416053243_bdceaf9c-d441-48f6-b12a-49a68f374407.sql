
ALTER TABLE public.forecast_prospective_evaluations DROP CONSTRAINT valid_direction;
ALTER TABLE public.forecast_prospective_evaluations ADD CONSTRAINT valid_direction
  CHECK (predicted_direction IN ('increasing', 'decreasing', 'stable', 'up', 'down'));
