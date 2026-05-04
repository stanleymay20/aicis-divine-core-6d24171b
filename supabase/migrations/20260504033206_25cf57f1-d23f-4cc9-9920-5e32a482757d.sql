revoke all on function public.ensure_l0_reporting_anchors() from public;
revoke all on function public.ensure_l0_reporting_anchors() from anon;
revoke all on function public.ensure_l0_reporting_anchors() from authenticated;
grant execute on function public.ensure_l0_reporting_anchors() to service_role;

revoke all on function public.ensure_country_profiles_from_normalized() from public;
revoke all on function public.ensure_country_profiles_from_normalized() from anon;
revoke all on function public.ensure_country_profiles_from_normalized() from authenticated;
grant execute on function public.ensure_country_profiles_from_normalized() to service_role;