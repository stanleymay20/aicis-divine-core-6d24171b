-- Source trust scoring table
CREATE TABLE public.source_trust_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL UNIQUE,
  source_type text NOT NULL DEFAULT 'general',
  credibility_weight integer NOT NULL DEFAULT 50,
  verification_level text NOT NULL DEFAULT 'secondary',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.source_trust_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read source trust scores" ON public.source_trust_scores FOR SELECT USING (true);

-- Signal routing feedback table
CREATE TABLE public.signal_routing_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.global_signals(id) ON DELETE CASCADE NOT NULL,
  feedback text NOT NULL DEFAULT 'unclear',
  category_correct boolean,
  impact_appropriate boolean,
  routing_appropriate boolean,
  reviewer_notes text,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_routing_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read routing feedback" ON public.signal_routing_feedback FOR SELECT USING (true);
CREATE POLICY "Anyone can create routing feedback" ON public.signal_routing_feedback FOR INSERT WITH CHECK (true);

-- Add trust and clustering columns to global_signals
ALTER TABLE public.global_signals
  ADD COLUMN IF NOT EXISTS source_trust_tier text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS multi_source_confirmed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_signal_ids uuid[] DEFAULT '{}';

-- Seed trusted sources
INSERT INTO public.source_trust_scores (source_name, source_type, credibility_weight, verification_level, notes) VALUES
  ('Associated Press', 'wire_agency', 97, 'primary', 'Global wire agency, highest trust'),
  ('Reuters', 'wire_agency', 97, 'primary', 'Global wire agency, highest trust'),
  ('AFP', 'wire_agency', 95, 'primary', 'Agence France-Presse'),
  ('BBC News', 'public_broadcaster', 93, 'primary', 'UK public broadcaster'),
  ('Al Jazeera English', 'international_broadcaster', 85, 'primary', 'Qatar-based, strong global coverage'),
  ('NPR', 'public_broadcaster', 90, 'primary', 'US public radio'),
  ('PBS', 'public_broadcaster', 90, 'primary', 'US public television'),
  ('The Wall Street Journal', 'financial_press', 92, 'primary', 'Leading US financial daily'),
  ('Financial Times', 'financial_press', 93, 'primary', 'Leading global financial daily'),
  ('Bloomberg', 'financial_press', 92, 'primary', 'Financial data and news'),
  ('CNBC', 'financial_press', 85, 'secondary', 'US business/financial news'),
  ('CNN', 'cable_news', 82, 'secondary', 'US cable news'),
  ('The Washington Post', 'newspaper', 88, 'primary', 'Major US newspaper'),
  ('The New York Times', 'newspaper', 90, 'primary', 'Major US newspaper of record'),
  ('The Guardian', 'newspaper', 87, 'primary', 'UK national newspaper'),
  ('Politico', 'political_press', 86, 'primary', 'US/EU political journalism'),
  ('The Economist', 'analysis', 92, 'primary', 'International analysis weekly'),
  ('Foreign Policy', 'analysis', 88, 'primary', 'Geopolitical analysis'),
  ('ABC News', 'broadcast_news', 83, 'secondary', 'US broadcast network'),
  ('CBS News', 'broadcast_news', 83, 'secondary', 'US broadcast network'),
  ('NBC News', 'broadcast_news', 83, 'secondary', 'US broadcast network'),
  ('Fox News', 'cable_news', 72, 'secondary', 'US cable news, editorial lean'),
  ('Sky News', 'broadcast_news', 82, 'secondary', 'UK/AU broadcast news'),
  ('Deutsche Welle', 'public_broadcaster', 87, 'primary', 'German international broadcaster'),
  ('NHK World', 'public_broadcaster', 85, 'primary', 'Japanese public broadcaster'),
  ('Xinhua', 'state_media', 60, 'secondary', 'Chinese state news agency'),
  ('RT', 'state_media', 35, 'aggregated', 'Russian state media'),
  ('Gizmodo.com', 'tech_blog', 45, 'aggregated', 'Tech/culture blog'),
  ('Eonline.com', 'entertainment', 30, 'aggregated', 'Entertainment news'),
  ('Hollywood Reporter', 'entertainment', 55, 'secondary', 'Entertainment industry trades')
ON CONFLICT (source_name) DO NOTHING;