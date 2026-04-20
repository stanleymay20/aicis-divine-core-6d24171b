DROP POLICY IF EXISTS "Authenticated users can insert community metrics" ON public.community_metrics;

CREATE POLICY "Verified node operators can insert community metrics"
  ON public.community_metrics FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.accountability_nodes an
      WHERE an.id = community_metrics.reporter_node_id
        AND an.verified = true
    )
  );