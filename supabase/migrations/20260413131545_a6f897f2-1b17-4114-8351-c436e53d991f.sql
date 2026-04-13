
ALTER VIEW public.planetary_scale_status SET (security_invoker = true);
ALTER VIEW public.planetary_job_offsets SET (security_invoker = true);
ALTER VIEW public.planetary_cron_health SET (security_invoker = true);
ALTER VIEW public.planetary_duplicate_rate SET (security_invoker = true);
ALTER VIEW public.planetary_country_integrity SET (security_invoker = true);
