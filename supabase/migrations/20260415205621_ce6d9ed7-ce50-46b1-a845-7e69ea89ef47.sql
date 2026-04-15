
-- Batch fix all remaining INSERT policies with WITH CHECK (true)
-- Using DO block for efficiency

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT tablename, policyname 
    FROM pg_policies 
    WHERE schemaname = 'public' 
    AND with_check = 'true' 
    AND cmd = 'INSERT'
    AND policyname LIKE 'Service role%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.role() = ''service_role'')', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Also fix the non-"Service role" ones
DROP POLICY IF EXISTS "Authenticated users can insert ADI scenarios" ON public.adi_scenarios;
CREATE POLICY "Authenticated users can insert ADI scenarios" ON public.adi_scenarios
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "calibration_metrics_write" ON public.calibration_metrics;
CREATE POLICY "calibration_metrics_write" ON public.calibration_metrics
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "domain_weights_write" ON public.domain_weights;
CREATE POLICY "domain_weights_write" ON public.domain_weights
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "forecast_archive_write" ON public.forecast_archive;
CREATE POLICY "forecast_archive_write" ON public.forecast_archive
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "forecast_jobs_write_service" ON public.forecast_jobs;
CREATE POLICY "forecast_jobs_write_service" ON public.forecast_jobs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "forecast_outcomes_write" ON public.forecast_outcomes;
CREATE POLICY "forecast_outcomes_write" ON public.forecast_outcomes
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "review_history_service_insert" ON public.decision_review_history;
CREATE POLICY "review_history_service_insert" ON public.decision_review_history
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "model_registry_write" ON public.model_registry;
CREATE POLICY "model_registry_write" ON public.model_registry
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Auth insert governance_discrepancies" ON public.governance_discrepancies;
CREATE POLICY "Auth insert governance_discrepancies" ON public.governance_discrepancies
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fix remaining UPDATE policies
DROP POLICY IF EXISTS "Service role can update tasks" ON public.objective_tasks;
CREATE POLICY "Service role can update tasks" ON public.objective_tasks
  FOR UPDATE USING (auth.role() = 'service_role');
