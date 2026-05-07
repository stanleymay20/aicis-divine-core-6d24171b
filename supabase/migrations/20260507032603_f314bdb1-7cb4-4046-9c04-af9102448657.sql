
CREATE TABLE IF NOT EXISTS public.aicis_relevance_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  organization_id uuid,
  organization_name text,
  industries text[] NOT NULL DEFAULT '{}',
  domains text[] NOT NULL DEFAULT '{}',
  countries text[] NOT NULL DEFAULT '{}',
  watched_entities text[] NOT NULL DEFAULT '{}',
  keywords text[] NOT NULL DEFAULT '{}',
  risk_priorities text[] NOT NULL DEFAULT '{}',
  operating_regions text[] NOT NULL DEFAULT '{}',
  business_functions text[] NOT NULL DEFAULT '{}',
  alert_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aicis_relevance_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "relevance_prefs_select_own"
  ON public.aicis_relevance_preferences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "relevance_prefs_insert_own"
  ON public.aicis_relevance_preferences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "relevance_prefs_update_own"
  ON public.aicis_relevance_preferences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "relevance_prefs_delete_own"
  ON public.aicis_relevance_preferences FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_relevance_prefs_updated_at
  BEFORE UPDATE ON public.aicis_relevance_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.aicis_relevance_evaluations
  ADD COLUMN IF NOT EXISTS match_contributors jsonb NOT NULL DEFAULT '[]'::jsonb;
