ALTER TABLE public.geonames_staging ENABLE ROW LEVEL SECURITY;
-- No policies: only service role / SECURITY DEFINER access.
REVOKE ALL ON public.geonames_staging FROM anon, authenticated;