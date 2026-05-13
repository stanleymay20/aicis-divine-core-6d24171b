-- User Preferred Language Translation Intelligence
-- Makes multilingual AICIS data useful by translating intelligence into each user's preferred language.
-- Adds user preferences, translation cache, translation queue, utility functions, and localized command views.

-- =====================================================
-- 1. User language preferences
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_language_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  preferred_language_code text NOT NULL DEFAULT 'en',
  preferred_language_name text DEFAULT 'English',
  fallback_language_code text DEFAULT 'en',
  auto_translate_enabled boolean DEFAULT true,
  preserve_original_text boolean DEFAULT true,
  translate_alerts boolean DEFAULT true,
  translate_executive_insights boolean DEFAULT true,
  translate_evidence boolean DEFAULT true,
  localization_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_language_preferences_language
ON public.user_language_preferences(preferred_language_code, auto_translate_enabled);

-- =====================================================
-- 2. Translation cache
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intelligence_translation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_key text UNIQUE NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  source_language_code text DEFAULT 'auto',
  target_language_code text NOT NULL,
  original_title text,
  translated_title text,
  original_summary text,
  translated_summary text,
  original_body text,
  translated_body text,
  translation_provider text DEFAULT 'pending',
  translation_quality_score numeric DEFAULT 0,
  confidence_score numeric DEFAULT 0,
  translation_status text DEFAULT 'pending',
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_subject
ON public.intelligence_translation_cache(subject_type, subject_id, target_language_code);

CREATE INDEX IF NOT EXISTS idx_translation_cache_status
ON public.intelligence_translation_cache(translation_status, target_language_code, created_at DESC);

-- =====================================================
-- 3. Translation queue
-- =====================================================
CREATE TABLE IF NOT EXISTS public.intelligence_translation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_key text UNIQUE NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  source_language_code text DEFAULT 'auto',
  target_language_code text NOT NULL,
  priority_score numeric DEFAULT 50,
  queue_status text DEFAULT 'queued',
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  available_at timestamptz DEFAULT now(),
  error_message text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_translation_queue_work
ON public.intelligence_translation_queue(queue_status, available_at, priority_score DESC, created_at);

-- =====================================================
-- 4. Supported language registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.supported_intelligence_languages (
  language_code text PRIMARY KEY,
  language_name text NOT NULL,
  native_name text,
  region_hint text,
  rtl boolean DEFAULT false,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.supported_intelligence_languages(language_code,language_name,native_name,region_hint,rtl)
VALUES
('en','English','English','global',false),
('de','German','Deutsch','europe',false),
('fr','French','Français','global',false),
('es','Spanish','Español','global',false),
('pt','Portuguese','Português','global',false),
('ar','Arabic','العربية','middle-east-africa',true),
('zh','Chinese','中文','east-asia',false),
('hi','Hindi','हिन्दी','south-asia',false),
('sw','Swahili','Kiswahili','africa',false),
('ha','Hausa','Hausa','west-africa',false),
('yo','Yoruba','Yorùbá','west-africa',false),
('tw','Twi','Twi','ghana',false),
('ru','Russian','Русский','eurasia',false),
('tr','Turkish','Türkçe','middle-east-europe',false),
('ja','Japanese','日本語','east-asia',false),
('ko','Korean','한국어','east-asia',false)
ON CONFLICT(language_code) DO UPDATE SET
  language_name = EXCLUDED.language_name,
  native_name = EXCLUDED.native_name,
  enabled = true;

-- =====================================================
-- 5. Language detection helper
-- =====================================================
CREATE OR REPLACE FUNCTION public.detect_signal_language_code(
  p_text text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN 'unknown';
  END IF;

  -- Lightweight heuristic fallback. Edge functions can overwrite with stronger AI/provider detection.
  IF p_text ~ '[\u0600-\u06FF]' THEN RETURN 'ar'; END IF;
  IF p_text ~ '[\u4E00-\u9FFF]' THEN RETURN 'zh'; END IF;
  IF p_text ~ '[\u0900-\u097F]' THEN RETURN 'hi'; END IF;
  IF p_text ~ '[\u3040-\u30FF]' THEN RETURN 'ja'; END IF;
  IF p_text ~ '[\uAC00-\uD7AF]' THEN RETURN 'ko'; END IF;

  IF lower(p_text) ~ '\m(und|der|die|das|nicht|mit|eine|ein|für)\M' THEN RETURN 'de'; END IF;
  IF lower(p_text) ~ '\m(le|la|les|des|une|avec|pour|dans|est)\M' THEN RETURN 'fr'; END IF;
  IF lower(p_text) ~ '\m(el|la|los|las|con|para|una|que|del)\M' THEN RETURN 'es'; END IF;
  IF lower(p_text) ~ '\m(o|a|os|as|com|para|uma|que|não)\M' THEN RETURN 'pt'; END IF;

  RETURN 'en';
END;
$$;

-- =====================================================
-- 6. User preference setter
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_user_preferred_language(
  p_user_id uuid,
  p_language_code text,
  p_auto_translate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_language_name text;
BEGIN
  SELECT language_name INTO v_language_name
  FROM public.supported_intelligence_languages
  WHERE language_code = lower(p_language_code)
    AND enabled = true;

  IF v_language_name IS NULL THEN
    RETURN jsonb_build_object('status','error','message','unsupported_language','language_code',p_language_code);
  END IF;

  INSERT INTO public.user_language_preferences(
    user_id, preferred_language_code, preferred_language_name, auto_translate_enabled, created_at, updated_at
  ) VALUES (
    p_user_id, lower(p_language_code), v_language_name, p_auto_translate, now(), now()
  )
  ON CONFLICT(user_id) DO UPDATE SET
    preferred_language_code = EXCLUDED.preferred_language_code,
    preferred_language_name = EXCLUDED.preferred_language_name,
    auto_translate_enabled = EXCLUDED.auto_translate_enabled,
    updated_at = now();

  RETURN jsonb_build_object('status','success','language_code',lower(p_language_code),'language_name',v_language_name);
END;
$$;

-- =====================================================
-- 7. Enqueue translation work
-- =====================================================
CREATE OR REPLACE FUNCTION public.enqueue_intelligence_translation(
  p_subject_type text,
  p_subject_id uuid,
  p_target_language_code text,
  p_source_language_code text DEFAULT 'auto',
  p_priority_score numeric DEFAULT 50,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.supported_intelligence_languages
    WHERE language_code = lower(p_target_language_code) AND enabled = true
  ) THEN
    RETURN jsonb_build_object('status','error','message','unsupported_language','language_code',p_target_language_code);
  END IF;

  v_key := md5(p_subject_type || '|' || COALESCE(p_subject_id::text,'none') || '|' || lower(p_target_language_code));

  INSERT INTO public.intelligence_translation_queue(
    queue_key, subject_type, subject_id, source_language_code, target_language_code,
    priority_score, queue_status, payload, available_at, created_at, updated_at
  ) VALUES (
    v_key, p_subject_type, p_subject_id, p_source_language_code, lower(p_target_language_code),
    LEAST(100,GREATEST(0,p_priority_score)), 'queued', p_payload, now(), now(), now()
  )
  ON CONFLICT(queue_key) DO UPDATE SET
    priority_score = GREATEST(public.intelligence_translation_queue.priority_score, EXCLUDED.priority_score),
    queue_status = CASE WHEN public.intelligence_translation_queue.queue_status = 'failed' THEN 'queued' ELSE public.intelligence_translation_queue.queue_status END,
    updated_at = now();

  RETURN jsonb_build_object('status','queued','queue_key',v_key);
END;
$$;

-- =====================================================
-- 8. Enqueue recent signals for preferred languages
-- =====================================================
CREATE OR REPLACE FUNCTION public.enqueue_recent_signal_translations(
  p_target_language_code text DEFAULT 'en',
  p_window interval DEFAULT interval '24 hours',
  p_min_relevance numeric DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.intelligence_translation_queue(
    queue_key, subject_type, subject_id, source_language_code, target_language_code,
    priority_score, queue_status, payload, available_at, created_at, updated_at
  )
  SELECT
    md5('signal|' || gs.id::text || '|' || lower(p_target_language_code)),
    'signal',
    gs.id,
    COALESCE(gs.language_code, public.detect_signal_language_code(COALESCE(gs.title, gs.summary, ''))),
    lower(p_target_language_code),
    LEAST(100, COALESCE(gs.relevance_score, gs.impact_score, 50)),
    'queued',
    jsonb_build_object(
      'title', gs.title,
      'summary', gs.summary,
      'category', gs.category,
      'impact_score', gs.impact_score,
      'urgency_score', gs.urgency_score,
      'source_language_code', COALESCE(gs.language_code, public.detect_signal_language_code(COALESCE(gs.title, gs.summary, '')))
    ),
    now(),now(),now()
  FROM public.global_signals gs
  WHERE COALESCE(gs.ingested_at,gs.created_at) >= now() - p_window
    AND COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
    AND COALESCE(gs.relevance_score, gs.impact_score, 0) >= p_min_relevance
    AND lower(COALESCE(gs.language_code, public.detect_signal_language_code(COALESCE(gs.title, gs.summary, '')))) <> lower(p_target_language_code)
  ON CONFLICT(queue_key) DO UPDATE SET
    priority_score = GREATEST(public.intelligence_translation_queue.priority_score, EXCLUDED.priority_score),
    queue_status = CASE WHEN public.intelligence_translation_queue.queue_status IN ('failed','cancelled') THEN 'queued' ELSE public.intelligence_translation_queue.queue_status END,
    payload = EXCLUDED.payload,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('enqueue-signal-translations','success','target=' || p_target_language_code || ', queued=' || v_rows);

  RETURN jsonb_build_object('status','success','target_language',p_target_language_code,'queued',v_rows);
END;
$$;

-- =====================================================
-- 9. Translation completion writer
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_intelligence_translation(
  p_subject_type text,
  p_subject_id uuid,
  p_target_language_code text,
  p_translated_title text DEFAULT NULL,
  p_translated_summary text DEFAULT NULL,
  p_translated_body text DEFAULT NULL,
  p_provider text DEFAULT 'external-provider',
  p_quality_score numeric DEFAULT 80,
  p_confidence_score numeric DEFAULT 80,
  p_source_language_code text DEFAULT 'auto',
  p_original_title text DEFAULT NULL,
  p_original_summary text DEFAULT NULL,
  p_original_body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := md5(p_subject_type || '|' || COALESCE(p_subject_id::text,'none') || '|' || lower(p_target_language_code));

  INSERT INTO public.intelligence_translation_cache(
    translation_key, subject_type, subject_id, source_language_code, target_language_code,
    original_title, translated_title, original_summary, translated_summary, original_body, translated_body,
    translation_provider, translation_quality_score, confidence_score, translation_status, updated_at, created_at
  ) VALUES (
    v_key, p_subject_type, p_subject_id, p_source_language_code, lower(p_target_language_code),
    p_original_title, p_translated_title, p_original_summary, p_translated_summary, p_original_body, p_translated_body,
    p_provider, p_quality_score, p_confidence_score, 'completed', now(), now()
  )
  ON CONFLICT(translation_key) DO UPDATE SET
    translated_title = EXCLUDED.translated_title,
    translated_summary = EXCLUDED.translated_summary,
    translated_body = EXCLUDED.translated_body,
    translation_provider = EXCLUDED.translation_provider,
    translation_quality_score = EXCLUDED.translation_quality_score,
    confidence_score = EXCLUDED.confidence_score,
    translation_status = 'completed',
    error_message = NULL,
    updated_at = now();

  UPDATE public.intelligence_translation_queue
  SET queue_status = 'completed', updated_at = now()
  WHERE queue_key = v_key;

  RETURN jsonb_build_object('status','completed','translation_key',v_key);
END;
$$;

-- =====================================================
-- 10. User-localized signal view function
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_localized_signals(
  p_user_id uuid DEFAULT NULL,
  p_language_code text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  signal_id uuid,
  display_title text,
  display_summary text,
  original_title text,
  original_summary text,
  source_language_code text,
  display_language_code text,
  translation_status text,
  category text,
  impact_score numeric,
  urgency_score numeric,
  relevance_score numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lang text;
BEGIN
  SELECT preferred_language_code INTO v_lang
  FROM public.user_language_preferences
  WHERE user_id = p_user_id
    AND auto_translate_enabled = true;

  v_lang := COALESCE(lower(p_language_code), v_lang, 'en');

  RETURN QUERY
  SELECT
    gs.id,
    COALESCE(tc.translated_title, gs.translated_title, gs.title) AS display_title,
    COALESCE(tc.translated_summary, gs.summary) AS display_summary,
    gs.title AS original_title,
    gs.summary AS original_summary,
    COALESCE(gs.language_code, public.detect_signal_language_code(COALESCE(gs.title, gs.summary, ''))) AS source_language_code,
    v_lang AS display_language_code,
    COALESCE(tc.translation_status, CASE WHEN lower(COALESCE(gs.language_code,'en')) = v_lang THEN 'original' ELSE 'missing_translation' END) AS translation_status,
    gs.category,
    gs.impact_score,
    gs.urgency_score,
    COALESCE(gs.relevance_score, gs.impact_score) AS relevance_score,
    COALESCE(gs.ingested_at,gs.created_at) AS created_at
  FROM public.global_signals gs
  LEFT JOIN public.intelligence_translation_cache tc
    ON tc.subject_type = 'signal'
   AND tc.subject_id = gs.id
   AND tc.target_language_code = v_lang
   AND tc.translation_status = 'completed'
  WHERE COALESCE(gs.canonical_event_status,'canonical') = 'canonical'
  ORDER BY COALESCE(gs.relevance_score, gs.impact_score,0) DESC, COALESCE(gs.ingested_at,gs.created_at) DESC
  LIMIT GREATEST(1,LEAST(p_limit,500));
END;
$$;

-- =====================================================
-- 11. Translation command views
-- =====================================================
CREATE OR REPLACE VIEW public.translation_operations_command_view AS
SELECT
  target_language_code,
  queue_status,
  COUNT(*) AS item_count,
  ROUND(AVG(priority_score)::numeric,2) AS avg_priority,
  MIN(created_at) AS oldest_item,
  MAX(created_at) AS newest_item
FROM public.intelligence_translation_queue
GROUP BY target_language_code, queue_status
ORDER BY target_language_code, queue_status;

CREATE OR REPLACE VIEW public.translation_cache_command_view AS
SELECT
  target_language_code,
  translation_status,
  COUNT(*) AS translation_count,
  ROUND(AVG(translation_quality_score)::numeric,2) AS avg_quality,
  ROUND(AVG(confidence_score)::numeric,2) AS avg_confidence,
  MAX(updated_at) AS latest_translation
FROM public.intelligence_translation_cache
GROUP BY target_language_code, translation_status
ORDER BY target_language_code, translation_status;

-- =====================================================
-- 12. Orchestrator
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_translation_intelligence_cycle(
  p_target_language_code text DEFAULT 'en',
  p_window interval DEFAULT interval '24 hours'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r1 jsonb;
BEGIN
  r1 := public.enqueue_recent_signal_translations(p_target_language_code, p_window, 50);

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES ('translation-intelligence-cycle','success','target=' || p_target_language_code);

  RETURN jsonb_build_object('status','success','target_language',p_target_language_code,'queue',r1);
END;
$$;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'user-language-translation-intelligence',
  'success',
  'preferred language profiles, translation cache, translation queue, localized signal view, and translation orchestration initialized'
);
