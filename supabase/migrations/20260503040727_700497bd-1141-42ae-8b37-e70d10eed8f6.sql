
SET lock_timeout = '5s';
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true
    ORDER BY p.proname
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
                     r.proname, r.args);
    EXCEPTION WHEN lock_not_available THEN
      RAISE NOTICE 'skip %: lock', r.proname;
    END;
  END LOOP;
END $$;
