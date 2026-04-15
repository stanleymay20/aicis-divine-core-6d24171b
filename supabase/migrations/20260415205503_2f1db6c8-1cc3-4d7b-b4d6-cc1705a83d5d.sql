
-- calibration_audit_hashes
DROP POLICY IF EXISTS "Service role manages audit hashes" ON public.calibration_audit_hashes;
CREATE POLICY "Service role manages audit hashes" ON public.calibration_audit_hashes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- country_performance_snapshots
DROP POLICY IF EXISTS "Service role can manage performance snapshots" ON public.country_performance_snapshots;
CREATE POLICY "Service role can manage performance snapshots" ON public.country_performance_snapshots
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- domain_coupling_matrix
DROP POLICY IF EXISTS "coupling_write_service" ON public.domain_coupling_matrix;
CREATE POLICY "coupling_write_service" ON public.domain_coupling_matrix
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- drift_alerts
DROP POLICY IF EXISTS "Service role manage drift alerts" ON public.drift_alerts;
CREATE POLICY "Service role manage drift alerts" ON public.drift_alerts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- election_calendar
DROP POLICY IF EXISTS "Service role manages election calendar" ON public.election_calendar;
CREATE POLICY "Service role manages election calendar" ON public.election_calendar
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- entity_aliases
DROP POLICY IF EXISTS "sr_aliases" ON public.entity_aliases;
CREATE POLICY "sr_aliases" ON public.entity_aliases
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- entity_external_ids
DROP POLICY IF EXISTS "sr_ext_ids" ON public.entity_external_ids;
CREATE POLICY "sr_ext_ids" ON public.entity_external_ids
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- entity_links
DROP POLICY IF EXISTS "sr_links" ON public.entity_links;
CREATE POLICY "sr_links" ON public.entity_links
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- entity_metric_links
DROP POLICY IF EXISTS "Service role manages metric links" ON public.entity_metric_links;
CREATE POLICY "Service role manages metric links" ON public.entity_metric_links
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
