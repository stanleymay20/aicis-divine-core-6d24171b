
-- Phase C — Lanes 2 & 3: Seed T2 wires/broadcasters + T3 specialist research
-- into source_authority_registry. Born at their true tier; never relabeled.

INSERT INTO public.source_authority_registry
  (publisher_key, publisher_name, publisher_type, authority_tier, default_confidence_weight, jurisdiction, base_url)
VALUES
  -- Tier 2 — reputable wires & national broadcasters
  ('reuters.com',      'Reuters',                                'wire',        2, 0.70, 'GLOBAL', 'https://www.reuters.com'),
  ('apnews.com',       'Associated Press',                       'wire',        2, 0.70, 'GLOBAL', 'https://apnews.com'),
  ('afp.com',          'Agence France-Presse',                   'wire',        2, 0.70, 'GLOBAL', 'https://www.afp.com'),
  ('bbc.co.uk',        'BBC News',                               'broadcaster', 2, 0.70, 'GBR',    'https://www.bbc.co.uk/news'),
  ('nytimes.com',      'The New York Times',                     'newspaper',   2, 0.70, 'USA',    'https://www.nytimes.com'),
  ('ft.com',           'Financial Times',                        'newspaper',   2, 0.70, 'GBR',    'https://www.ft.com'),
  ('theguardian.com',  'The Guardian',                           'newspaper',   2, 0.70, 'GBR',    'https://www.theguardian.com'),
  ('nhk.or.jp',        'NHK World',                              'broadcaster', 2, 0.70, 'JPN',    'https://www3.nhk.or.jp/nhkworld'),
  ('tagesschau.de',    'ARD Tagesschau',                         'broadcaster', 2, 0.70, 'DEU',    'https://www.tagesschau.de'),
  ('abc.net.au',       'ABC Australia',                          'broadcaster', 2, 0.70, 'AUS',    'https://www.abc.net.au/news'),
  ('cbc.ca',           'CBC News',                               'broadcaster', 2, 0.70, 'CAN',    'https://www.cbc.ca/news'),
  ('dpa.com',          'Deutsche Presse-Agentur',                'wire',        2, 0.70, 'DEU',    'https://www.dpa.com'),
  -- Tier 3 — specialist research / ratings / policy
  ('iea.org',          'International Energy Agency',            'research',    3, 0.50, 'GLOBAL', 'https://www.iea.org'),
  ('bis.org/papers',   'Bank for International Settlements (Working Papers)', 'research', 3, 0.50, 'GLOBAL', 'https://www.bis.org'),
  ('crisisgroup.org',  'International Crisis Group',             'research',    3, 0.50, 'GLOBAL', 'https://www.crisisgroup.org'),
  ('spglobal.com',     'S&P Global',                             'ratings',     3, 0.50, 'GLOBAL', 'https://www.spglobal.com'),
  ('fitchratings.com', 'Fitch Ratings',                          'ratings',     3, 0.50, 'GLOBAL', 'https://www.fitchratings.com'),
  ('moodys.com',       'Moody''s',                               'ratings',     3, 0.50, 'GLOBAL', 'https://www.moodys.com'),
  ('openalex.org',     'OpenAlex (policy & research works)',     'research',    3, 0.50, 'GLOBAL', 'https://api.openalex.org')
ON CONFLICT (publisher_key) DO UPDATE
  SET publisher_name             = EXCLUDED.publisher_name,
      publisher_type             = EXCLUDED.publisher_type,
      authority_tier             = EXCLUDED.authority_tier,
      default_confidence_weight  = EXCLUDED.default_confidence_weight,
      jurisdiction               = EXCLUDED.jurisdiction,
      base_url                   = EXCLUDED.base_url;
