GRANT ALL ON public.geonames_staging TO authenticated;
GRANT ALL ON public.geonames_staging TO anon;
GRANT EXECUTE ON FUNCTION public.geonames_bulk_upsert(jsonb) TO authenticated;