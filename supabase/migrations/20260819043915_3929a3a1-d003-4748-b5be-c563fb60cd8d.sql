REVOKE ALL ON FUNCTION public.compute_pns_certification_gate_i() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_pns_certification_gate_i() TO service_role;