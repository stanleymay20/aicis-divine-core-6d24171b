
DROP POLICY IF EXISTS "Service write microdata_indicators" ON public.microdata_indicators;
CREATE POLICY "Service write microdata_indicators" ON public.microdata_indicators
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service write microdata_sources" ON public.microdata_sources;
CREATE POLICY "Service write microdata_sources" ON public.microdata_sources
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manage calibration profiles" ON public.model_calibration_profiles;
CREATE POLICY "Service role manage calibration profiles" ON public.model_calibration_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "sr_rollback_all" ON public.model_rollback_history;
CREATE POLICY "sr_rollback_all" ON public.model_rollback_history
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages events" ON public.normalized_events;
CREATE POLICY "Service role manages events" ON public.normalized_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages metrics" ON public.normalized_metrics;
CREATE POLICY "Service role manages metrics" ON public.normalized_metrics
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages webhook queue" ON public.quantivis_webhook_queue;
CREATE POLICY "Service role manages webhook queue" ON public.quantivis_webhook_queue
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages seed attempts" ON public.village_seed_attempts;
CREATE POLICY "Service role manages seed attempts" ON public.village_seed_attempts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
