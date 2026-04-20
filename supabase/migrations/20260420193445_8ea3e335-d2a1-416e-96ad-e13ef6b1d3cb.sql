
-- ── Alert preferences per user ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_preferences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Severity: which levels to show
  min_severity TEXT NOT NULL DEFAULT 'low'
               CHECK (min_severity IN ('critical','high','medium','low')),
  -- Divisions to INCLUDE (empty array = all)
  divisions    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Countries to INCLUDE (ISO codes or names; empty = all)
  countries    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Mute keywords (case-insensitive substring match against title+message)
  mute_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Show acknowledged?
  show_acknowledged BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own alert prefs"
  ON public.alert_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own alert prefs"
  ON public.alert_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own alert prefs"
  ON public.alert_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own alert prefs"
  ON public.alert_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE TRIGGER alert_preferences_set_updated_at
  BEFORE UPDATE ON public.alert_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
