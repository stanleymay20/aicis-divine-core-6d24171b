
-- ALL policies → service_role
DROP POLICY IF EXISTS "thresholds_service_all" ON public.decision_metric_thresholds;
CREATE POLICY "thresholds_service_all" ON public.decision_metric_thresholds
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages decision models" ON public.decision_models;
CREATE POLICY "Service role manages decision models" ON public.decision_models
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "sr_merge_log" ON public.entity_merge_log;
CREATE POLICY "sr_merge_log" ON public.entity_merge_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage ethics reviewers" ON public.ethics_reviewers;
CREATE POLICY "Service role can manage ethics reviewers" ON public.ethics_reviewers
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manage residuals" ON public.forecast_residuals;
CREATE POLICY "Service role manage residuals" ON public.forecast_residuals
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- UPDATE policies → service_role
DROP POLICY IF EXISTS "Service role can update ADI decisions" ON public.adi_decisions;
CREATE POLICY "Service role can update ADI decisions" ON public.adi_decisions
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update conflict signals" ON public.conflict_signals;
CREATE POLICY "Service role can update conflict signals" ON public.conflict_signals
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update country profiles" ON public.country_profiles;
CREATE POLICY "Service role can update country profiles" ON public.country_profiles
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update signals" ON public.global_signals;
CREATE POLICY "Service role can update signals" ON public.global_signals
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "forecast_jobs_update_service" ON public.forecast_jobs;
CREATE POLICY "forecast_jobs_update_service" ON public.forecast_jobs
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "forecast_outcomes_update" ON public.forecast_outcomes;
CREATE POLICY "forecast_outcomes_update" ON public.forecast_outcomes
  FOR UPDATE USING (auth.role() = 'service_role');

-- INSERT policies on sensitive tables → service_role
DROP POLICY IF EXISTS "Service role can insert ADI decisions" ON public.adi_decisions;
CREATE POLICY "Service role can insert ADI decisions" ON public.adi_decisions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can insert ADI scenarios" ON public.adi_scenarios;
CREATE POLICY "Service role can insert ADI scenarios" ON public.adi_scenarios
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can insert billing_events" ON public.billing_events;
CREATE POLICY "Service role can insert billing_events" ON public.billing_events
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
