UPDATE public.organizations SET tier = 'sovereign' WHERE id = '2f11a2e5-28c6-4c3b-9aa0-2682ec7a3cb8';

INSERT INTO public.user_roles (user_id, role)
VALUES ('9b5a5758-c324-4041-9bdb-77a7b4e6067a', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'prospective%'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
  END LOOP;
END $$;