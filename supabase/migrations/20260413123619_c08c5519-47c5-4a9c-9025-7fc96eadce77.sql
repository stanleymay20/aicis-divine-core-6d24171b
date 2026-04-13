
-- 1. Create sovereignty_status enum
CREATE TYPE public.sovereignty_status AS ENUM (
  'sovereign_state',
  'territory',
  'disputed',
  'aggregate',
  'source_only',
  'deprecated'
);

-- 2. Add column to canonical_entities
ALTER TABLE public.canonical_entities 
  ADD COLUMN IF NOT EXISTS sovereignty_status public.sovereignty_status;

-- 3. Auto-classify existing entities

-- Disputed entities
UPDATE canonical_entities SET sovereignty_status = 'disputed'
WHERE entity_type IN ('country','territory') 
  AND iso3 IN ('XKX','PSE','TWN','ESH');

-- Territories (dependent/non-self-governing)
UPDATE canonical_entities SET sovereignty_status = 'territory'
WHERE entity_type IN ('country','territory')
  AND iso3 IN (
    'ABW','ASM','BMU','CUW','CYM','FRO','GRL','GUM','HKG','IMN',
    'MAC','MAF','MNP','NCL','PRI','PYF','SXM','TCA','VGB','VIR'
  )
  AND sovereignty_status IS NULL;

-- Everything else that is country/territory type = sovereign_state
UPDATE canonical_entities SET sovereignty_status = 'sovereign_state'
WHERE entity_type IN ('country','territory')
  AND sovereignty_status IS NULL;

-- 4. Coverage layer view — ALL valid country-like entities
CREATE OR REPLACE VIEW public.country_coverage_full AS
SELECT 
  ce.id,
  ce.iso3,
  ce.canonical_name,
  ce.display_name,
  ce.entity_type::text AS entity_type,
  ce.sovereignty_status::text AS sovereignty_status,
  ce.lat, ce.lon,
  ce.trust_score,
  ce.source_count,
  (SELECT COUNT(*) FROM normalized_metrics nm WHERE nm.iso3 = ce.iso3) AS metric_count,
  (SELECT COUNT(*) FROM normalized_events ne WHERE ne.iso3 = ce.iso3) AS event_count
FROM canonical_entities ce
WHERE ce.entity_type IN ('country','territory')
  AND ce.sovereignty_status != 'deprecated'
ORDER BY ce.iso3;

-- 5. Canonical reporting layer — approved for scoring/dashboards
CREATE OR REPLACE VIEW public.canonical_reporting_countries AS
SELECT 
  ce.id,
  ce.iso3,
  ce.canonical_name,
  ce.display_name,
  ce.sovereignty_status::text AS sovereignty_status,
  ce.lat, ce.lon,
  ce.trust_score
FROM canonical_entities ce
WHERE ce.entity_type IN ('country','territory')
  AND ce.sovereignty_status IN ('sovereign_state','territory','disputed')
ORDER BY ce.iso3;

-- 6. Reconciliation audit view
CREATE OR REPLACE VIEW public.country_reconciliation_audit AS
WITH coverage AS (
  SELECT COUNT(*) AS total_coverage
  FROM canonical_entities 
  WHERE entity_type IN ('country','territory') AND sovereignty_status != 'deprecated'
),
reporting AS (
  SELECT COUNT(*) AS total_reporting
  FROM canonical_entities 
  WHERE entity_type IN ('country','territory') 
    AND sovereignty_status IN ('sovereign_state','territory','disputed')
),
aggregates AS (
  SELECT COUNT(*) AS total_aggregates
  FROM canonical_entities 
  WHERE entity_type IN ('country','territory') AND sovereignty_status = 'aggregate'
),
source_only AS (
  SELECT COUNT(*) AS total_source_only
  FROM canonical_entities 
  WHERE entity_type IN ('country','territory') AND sovereignty_status = 'source_only'
),
deprecated AS (
  SELECT COUNT(*) AS total_deprecated
  FROM canonical_entities 
  WHERE entity_type IN ('country','territory') AND sovereignty_status = 'deprecated'
),
unmapped_metrics AS (
  SELECT COUNT(DISTINCT iso3) AS unmapped_metric_codes
  FROM normalized_metrics nm
  WHERE nm.iso3 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM canonical_entities ce 
      WHERE ce.iso3 = nm.iso3 AND ce.entity_type IN ('country','territory')
    )
),
dup_check AS (
  SELECT COUNT(*) AS duplicate_iso3_count
  FROM (
    SELECT iso3 FROM canonical_entities 
    WHERE entity_type IN ('country','territory') AND iso3 IS NOT NULL
    GROUP BY iso3 HAVING COUNT(*) > 1
  ) d
)
SELECT 
  c.total_coverage,
  r.total_reporting,
  a.total_aggregates,
  s.total_source_only,
  dep.total_deprecated,
  c.total_coverage - r.total_reporting AS coverage_reporting_diff,
  u.unmapped_metric_codes,
  dc.duplicate_iso3_count
FROM coverage c, reporting r, aggregates a, source_only s, deprecated dep, unmapped_metrics u, dup_check dc;

-- 7. Add WB/IMF/UN recognized entities that are missing
-- These are source-recognized country-like entities tracked by major data providers

-- Channel Islands (WB code CHI)
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score, metadata)
VALUES ('Channel Islands', 'territory', 'CHI', 'aggregate', 'Channel Islands (Jersey + Guernsey)', 0.7, '{"note":"WB aggregate for Jersey+Guernsey"}'::jsonb)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Gibraltar
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score, metadata)
VALUES ('Gibraltar', 'territory', 'GIB', 'territory', 'Gibraltar', 0.8, '{"parent":"GBR"}'::jsonb)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Liechtenstein (may be missing)
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('Liechtenstein', 'country', 'LIE', 'sovereign_state', 'Liechtenstein', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Monaco
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('Monaco', 'country', 'MCO', 'sovereign_state', 'Monaco', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- San Marino
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('San Marino', 'country', 'SMR', 'sovereign_state', 'San Marino', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- South Sudan
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('South Sudan', 'country', 'SSD', 'sovereign_state', 'South Sudan', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Tuvalu
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('Tuvalu', 'country', 'TUV', 'sovereign_state', 'Tuvalu', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Nauru
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('Nauru', 'country', 'NRU', 'sovereign_state', 'Nauru', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Palau
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('Palau', 'country', 'PLW', 'sovereign_state', 'Palau', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Marshall Islands
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score)
VALUES ('Marshall Islands', 'country', 'MHL', 'sovereign_state', 'Marshall Islands', 0.9)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Taiwan (disputed status)
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score, metadata)
VALUES ('Taiwan, China', 'territory', 'TWN', 'disputed', 'Taiwan', 0.85, '{"note":"WB labels as Taiwan, China; disputed sovereignty"}'::jsonb)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- Western Sahara (disputed)
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score, metadata)
VALUES ('Western Sahara', 'territory', 'ESH', 'disputed', 'Western Sahara', 0.6, '{"note":"Non-self-governing, disputed sovereignty"}'::jsonb)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- WB aggregate codes — mark as aggregate, not for reporting
INSERT INTO canonical_entities (canonical_name, entity_type, iso3, sovereignty_status, display_name, trust_score, metadata)
VALUES 
  ('World', 'country', 'WLD', 'aggregate', 'World (WB aggregate)', 0.5, '{"source":"worldbank","type":"aggregate"}'::jsonb),
  ('High Income', 'country', 'HIC', 'aggregate', 'High Income Countries', 0.5, '{"source":"worldbank","type":"income_group"}'::jsonb),
  ('Low Income', 'country', 'LIC', 'aggregate', 'Low Income Countries', 0.5, '{"source":"worldbank","type":"income_group"}'::jsonb),
  ('Lower Middle Income', 'country', 'LMC', 'aggregate', 'Lower Middle Income Countries', 0.5, '{"source":"worldbank","type":"income_group"}'::jsonb),
  ('Upper Middle Income', 'country', 'UMC', 'aggregate', 'Upper Middle Income Countries', 0.5, '{"source":"worldbank","type":"income_group"}'::jsonb),
  ('Sub-Saharan Africa', 'country', 'SSF', 'aggregate', 'Sub-Saharan Africa (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('East Asia & Pacific', 'country', 'EAS', 'aggregate', 'East Asia & Pacific (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('Europe & Central Asia', 'country', 'ECS', 'aggregate', 'Europe & Central Asia (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('Latin America & Caribbean', 'country', 'LCN', 'aggregate', 'Latin America & Caribbean (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('Middle East & North Africa', 'country', 'MEA', 'aggregate', 'Middle East & North Africa (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('North America', 'country', 'NAC', 'aggregate', 'North America (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('South Asia', 'country', 'SAS', 'aggregate', 'South Asia (WB)', 0.5, '{"source":"worldbank","type":"region"}'::jsonb),
  ('European Union', 'country', 'EUU', 'aggregate', 'European Union (WB)', 0.5, '{"source":"worldbank","type":"political_group"}'::jsonb),
  ('Euro Area', 'country', 'EMU', 'aggregate', 'Euro Area (WB)', 0.5, '{"source":"worldbank","type":"monetary_group"}'::jsonb),
  ('OECD Members', 'country', 'OED', 'aggregate', 'OECD Members (WB)', 0.5, '{"source":"worldbank","type":"org_group"}'::jsonb)
ON CONFLICT (entity_type, normalized_name) DO NOTHING;

-- 8. Update is_canonical_iso3() to use sovereignty_status for reporting checks
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
      AND sovereignty_status IN ('sovereign_state', 'territory', 'disputed')
  );
$$;

-- 9. New function: check if ISO3 is in full coverage (including aggregates)
CREATE OR REPLACE FUNCTION public.is_covered_iso3(_iso3 text)
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
      AND sovereignty_status != 'deprecated'
  );
$$;
