-- Add provenance + source_id for chunked, idempotent upserts
ALTER TABLE public.aicis_geo_entities
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_entities_source
  ON public.aicis_geo_entities(source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geo_entities_source
  ON public.aicis_geo_entities(source);

-- Alias dedup
CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_aliases_entity_alias
  ON public.aicis_geo_aliases(geo_entity_id, lower(alias));

-- ISO2 → ISO3 mapping (GeoNames uses ISO2)
CREATE TABLE IF NOT EXISTS public.iso_country_map (
  iso2 text PRIMARY KEY,
  iso3 text NOT NULL,
  name text
);
ALTER TABLE public.iso_country_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iso_country_map readable" ON public.iso_country_map;
CREATE POLICY "iso_country_map readable" ON public.iso_country_map FOR SELECT USING (true);

-- Staging table for bulk COPY from GeoNames
CREATE UNLOGGED TABLE IF NOT EXISTS public.geonames_staging (
  geonameid bigint,
  name text,
  asciiname text,
  alternatenames text,
  latitude double precision,
  longitude double precision,
  feature_class text,
  feature_code text,
  country_code text,
  cc2 text,
  admin1_code text,
  admin2_code text,
  admin3_code text,
  admin4_code text,
  population bigint,
  elevation int,
  dem int,
  timezone text,
  modification_date date
);

CREATE INDEX IF NOT EXISTS idx_geonames_staging_class ON public.geonames_staging(feature_class);
CREATE INDEX IF NOT EXISTS idx_geonames_staging_cc ON public.geonames_staging(country_code);