
INSERT INTO public.source_authority_registry (publisher_key, publisher_name, publisher_type, authority_tier, default_confidence_weight, base_url)
VALUES
  ('imf.org',       'International Monetary Fund',         'igo',          1, 1.0, 'https://www.imf.org'),
  ('worldbank.org', 'World Bank',                          'igo',          1, 1.0, 'https://www.worldbank.org'),
  ('oecd.org',      'OECD',                                'igo',          1, 1.0, 'https://www.oecd.org'),
  ('wfp.org',       'World Food Programme',                'igo',          1, 1.0, 'https://www.wfp.org'),
  ('unocha.org',    'UN OCHA',                             'igo',          1, 1.0, 'https://www.unocha.org'),
  ('bis.org',       'Bank for International Settlements',  'central_bank', 1, 1.0, 'https://www.bis.org'),
  ('reliefweb.int', 'ReliefWeb (UN OCHA)',                 'igo',          1, 1.0, 'https://reliefweb.int')
ON CONFLICT (publisher_key) DO UPDATE
  SET authority_tier = 1, default_confidence_weight = 1.0;

ALTER TABLE public.intelligence_citations
  ADD COLUMN IF NOT EXISTS ingest_lane text;

CREATE INDEX IF NOT EXISTS idx_citations_ingest_lane
  ON public.intelligence_citations(ingest_lane)
  WHERE ingest_lane IS NOT NULL;
