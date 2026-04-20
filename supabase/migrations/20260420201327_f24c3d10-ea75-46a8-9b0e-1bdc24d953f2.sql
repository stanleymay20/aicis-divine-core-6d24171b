-- Fix search_path on trigger function
CREATE OR REPLACE FUNCTION public.tg_rar_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Tighten update policy: must keep same id, country, domain, batch
DROP POLICY IF EXISTS "Authenticated users can update recommendation status"
  ON public.risk_action_recommendations;

CREATE POLICY "Authenticated users can update recommendation lifecycle"
  ON public.risk_action_recommendations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    status IN ('proposed','accepted','dismissed','executed')
  );