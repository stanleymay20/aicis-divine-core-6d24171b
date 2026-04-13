
-- 1. Seed the 3 missing entities as territories
INSERT INTO canonical_entities (canonical_name, normalized_name, entity_type, iso3, trust_score, source_count, metadata)
VALUES
  ('Hong Kong SAR, China', 'hong kong sar, china', 'territory', 'HKG', 0.95, 1, '{"region":"East Asia & Pacific","income_group":"High income"}'),
  ('Macao SAR, China', 'macao sar, china', 'territory', 'MAC', 0.90, 1, '{"region":"East Asia & Pacific","income_group":"High income"}'),
  ('West Bank and Gaza', 'west bank and gaza', 'territory', 'PSE', 0.85, 1, '{"region":"Middle East & North Africa","income_group":"Lower middle income"}')
ON CONFLICT DO NOTHING;

-- 2. Create canonical country list view (all countries + territories = our "211" canonical set)
CREATE OR REPLACE VIEW canonical_country_list AS
SELECT id, iso3, canonical_name, entity_type::text
FROM canonical_entities
WHERE entity_type::text IN ('country', 'territory')
  AND iso3 IS NOT NULL
ORDER BY iso3;

-- 3. Create ISO3 validation function for ingestion filtering
CREATE OR REPLACE FUNCTION public.is_canonical_iso3(_iso3 text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM canonical_entities
    WHERE iso3 = _iso3
      AND entity_type::text IN ('country', 'territory')
  );
$$;

-- 4. Delete orphan metrics with blank ISO3
DELETE FROM normalized_metrics WHERE iso3 IS NULL OR iso3 = '';
