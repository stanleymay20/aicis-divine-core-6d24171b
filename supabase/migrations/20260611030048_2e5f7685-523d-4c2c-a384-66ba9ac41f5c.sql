
INSERT INTO public.source_authority_registry
  (publisher_key, publisher_name, publisher_type, authority_tier, default_confidence_weight, base_url)
VALUES
  ('imf.org',       'International Monetary Fund',                              'official', 1, 1.0, 'https://www.imf.org'),
  ('oecd.org',      'Organisation for Economic Co-operation and Development',   'official', 1, 1.0, 'https://www.oecd.org'),
  ('worldbank.org', 'World Bank',                                               'official', 1, 1.0, 'https://www.worldbank.org')
ON CONFLICT (publisher_key) DO UPDATE
  SET authority_tier            = EXCLUDED.authority_tier,
      publisher_name            = EXCLUDED.publisher_name,
      publisher_type            = EXCLUDED.publisher_type,
      default_confidence_weight = EXCLUDED.default_confidence_weight,
      base_url                  = EXCLUDED.base_url;
