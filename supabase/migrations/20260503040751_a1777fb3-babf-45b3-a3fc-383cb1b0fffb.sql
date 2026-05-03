
SET lock_timeout = '5s';
DO $$
DECLARE r RECORD;
  allowlist text[] := ARRAY['get_public_status','is_canonical_iso3','is_covered_iso3','has_role'];
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true
    ORDER BY p.proname
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, authenticated, PUBLIC',
                     r.proname, r.args);
      IF r.proname = ANY(allowlist) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated',
                       r.proname, r.args);
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      RAISE NOTICE 'skip %', r.proname;
    END;
  END LOOP;
END $$;
