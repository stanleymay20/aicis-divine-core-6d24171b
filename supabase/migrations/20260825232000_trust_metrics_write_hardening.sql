-- Trust metrics are public-readable evidence, but only privileged backend code may write them.
-- The legacy INSERT policy used WITH CHECK (true), which did not create a meaningful RLS boundary.
DROP POLICY IF EXISTS "System can insert trust metrics" ON public.trust_metrics;

REVOKE INSERT, UPDATE, DELETE ON public.trust_metrics FROM anon, authenticated;

COMMENT ON COLUMN public.trust_metrics.signature IS
  'Legacy field used for an integrity marker. Current compute-trust-metrics writes a SHA-256 digest and explicitly does not treat it as an authenticity signature.';

COMMENT ON TABLE public.trust_metrics IS
  'Public-readable operational evidence metrics. Values are measurements with explicit metadata boundaries and must not be interpreted as legal, security, or certification attestations.';
