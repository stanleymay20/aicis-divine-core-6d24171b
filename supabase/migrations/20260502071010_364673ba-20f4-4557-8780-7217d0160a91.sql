GRANT ALL ON public.geonames_staging TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.geonames_bulk_upsert(jsonb) TO sandbox_exec;
GRANT EXECUTE ON FUNCTION public.geonames_bulk_upsert(jsonb) TO anon;