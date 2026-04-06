
-- 1. Fix adi_decisions: restrict UPDATE to admin/operator
DROP POLICY IF EXISTS "Authenticated users can update ADI decisions" ON public.adi_decisions;
CREATE POLICY "Admin/operator can update ADI decisions"
  ON public.adi_decisions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- 2. Fix routing_threshold_config: restrict ALL to admin/operator
DROP POLICY IF EXISTS "Authenticated users can manage routing thresholds" ON public.routing_threshold_config;
CREATE POLICY "Admin/operator can manage routing thresholds"
  ON public.routing_threshold_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));
-- Keep read access for authenticated users
CREATE POLICY "Authenticated users can read routing thresholds"
  ON public.routing_threshold_config FOR SELECT TO authenticated
  USING (true);

-- 3. Fix source_connector_runs: restrict INSERT to service_role only
DROP POLICY IF EXISTS "Service role can insert connector runs" ON public.source_connector_runs;
CREATE POLICY "Service role can insert connector runs"
  ON public.source_connector_runs FOR INSERT TO service_role
  WITH CHECK (true);

-- 4. Fix audit_log: remove public insert, keep service_role only
DROP POLICY IF EXISTS "Auth insert audit_log" ON public.audit_log;
-- service_role INSERT policies already exist, no new policy needed

-- 5. Fix signal_routing_feedback: require authentication
DROP POLICY IF EXISTS "Anyone can create routing feedback" ON public.signal_routing_feedback;
DROP POLICY IF EXISTS "Anyone can read routing feedback" ON public.signal_routing_feedback;
CREATE POLICY "Authenticated users can create routing feedback"
  ON public.signal_routing_feedback FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated users can read routing feedback"
  ON public.signal_routing_feedback FOR SELECT TO authenticated
  USING (true);

-- 6. Fix signal_quality_metrics_daily: restrict to service_role
DROP POLICY IF EXISTS "Service role can insert quality metrics" ON public.signal_quality_metrics_daily;
DROP POLICY IF EXISTS "Service role can update quality metrics" ON public.signal_quality_metrics_daily;
CREATE POLICY "Service role can insert quality metrics"
  ON public.signal_quality_metrics_daily FOR INSERT TO service_role
  WITH CHECK (true);
CREATE POLICY "Service role can update quality metrics"
  ON public.signal_quality_metrics_daily FOR UPDATE TO service_role
  USING (true);
