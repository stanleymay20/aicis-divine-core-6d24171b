
DROP POLICY IF EXISTS "Service role manage telemetry" ON public.operational_telemetry;
CREATE POLICY "Service role manage telemetry" ON public.operational_telemetry
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages political events" ON public.political_events;
CREATE POLICY "Service role manages political events" ON public.political_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages stability scores" ON public.political_stability_scores;
CREATE POLICY "Service role manages stability scores" ON public.political_stability_scores
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update SDG progress" ON public.sdg_progress;
CREATE POLICY "Service role can update SDG progress" ON public.sdg_progress
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can update quality metrics" ON public.signal_quality_metrics_daily;
CREATE POLICY "Service role can update quality metrics" ON public.signal_quality_metrics_daily
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can create routing feedback" ON public.signal_routing_feedback;
CREATE POLICY "Authenticated users can create routing feedback" ON public.signal_routing_feedback
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role manage silent_failure_state" ON public.silent_failure_state;
DROP POLICY IF EXISTS "silent_failure_update_service" ON public.silent_failure_state;
DROP POLICY IF EXISTS "silent_failure_insert_service" ON public.silent_failure_state;
CREATE POLICY "Service role manage silent_failure_state" ON public.silent_failure_state
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages SPC" ON public.spc_control_observations;
CREATE POLICY "Service role manages SPC" ON public.spc_control_observations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
