-- Phase 3.5 + 3.1: Country extraction + Language router schema

-- Country extraction fields
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS country_extraction_status text,
  ADD COLUMN IF NOT EXISTS country_extraction_confidence smallint,
  ADD COLUMN IF NOT EXISTS country_extraction_method text,
  ADD COLUMN IF NOT EXISTS extracted_country_candidates jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS country_extracted_at timestamptz;

-- Language router fields
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS source_language_confidence numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS language_detector text,
  ADD COLUMN IF NOT EXISTS language_family text,
  ADD COLUMN IF NOT EXISTS script_detected text,
  ADD COLUMN IF NOT EXISTS is_low_resource_language boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS language_tier text,
  ADD COLUMN IF NOT EXISTS translation_defer_reason text,
  ADD COLUMN IF NOT EXISTS language_routed_at timestamptz;

-- Indexes for batch selection
CREATE INDEX IF NOT EXISTS idx_global_signals_country_extracted_at
  ON public.global_signals (country_extracted_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_global_signals_language_routed_at
  ON public.global_signals (language_routed_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_global_signals_translation_status
  ON public.global_signals (translation_status);

CREATE INDEX IF NOT EXISTS idx_global_signals_geo_method
  ON public.global_signals (geo_method);

CREATE INDEX IF NOT EXISTS idx_global_signals_affected_countries_gin
  ON public.global_signals USING GIN (affected_countries);
