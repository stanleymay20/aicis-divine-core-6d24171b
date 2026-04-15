
-- Fix 4 security definer views by adding security_invoker = true
ALTER VIEW public.quantivis_country_dashboard SET (security_invoker = true);
ALTER VIEW public.quantivis_entity_graph SET (security_invoker = true);
ALTER VIEW public.quantivis_event_feed SET (security_invoker = true);
ALTER VIEW public.quantivis_signals_feed SET (security_invoker = true);

-- Tighten the most critical permissive RLS policies 
-- billing_usage_queue: restrict ALL to service_role
DROP POLICY IF EXISTS "Service role can manage billing usage" ON public.billing_usage_queue;
CREATE POLICY "Service role can manage billing usage" ON public.billing_usage_queue
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- canonical_entities: restrict ALL to service_role (public reads handled by separate SELECT policy)
DROP POLICY IF EXISTS "sr_entities" ON public.canonical_entities;
CREATE POLICY "sr_entities" ON public.canonical_entities
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- entity_event_links: restrict write to service_role
DROP POLICY IF EXISTS "Service role manages event links" ON public.entity_event_links;
CREATE POLICY "Service role manages event links" ON public.entity_event_links
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
