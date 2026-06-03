
INSERT INTO public.source_authority_registry(publisher_key, publisher_name, publisher_type, authority_tier, default_confidence_weight, jurisdiction, base_url) VALUES
  ('imf','International Monetary Fund','imf',1,0.95,'GLOBAL','https://www.imf.org'),
  ('world_bank','World Bank','world_bank',1,0.95,'GLOBAL','https://data.worldbank.org'),
  ('iaea','International Atomic Energy Agency','iaea',1,0.95,'GLOBAL','https://www.iaea.org'),
  ('un','United Nations','un',1,0.95,'GLOBAL','https://www.un.org'),
  ('who','World Health Organization','un',1,0.93,'GLOBAL','https://www.who.int'),
  ('ofac_us','OFAC (US Treasury)','sanctions',1,0.97,'US','https://ofac.treasury.gov'),
  ('eu_sanctions','EU Sanctions Map','sanctions',1,0.97,'EU','https://www.sanctionsmap.eu'),
  ('uk_sanctions','UK OFSI Sanctions','sanctions',1,0.97,'UK','https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation'),
  ('un_sanctions','UN Security Council Sanctions','sanctions',1,0.97,'GLOBAL','https://www.un.org/securitycouncil/sanctions'),
  ('ecb','European Central Bank','central_bank',1,0.95,'EU','https://www.ecb.europa.eu'),
  ('fed_us','US Federal Reserve','central_bank',1,0.95,'US','https://www.federalreserve.gov'),
  ('boe','Bank of England','central_bank',1,0.95,'UK','https://www.bankofengland.co.uk'),
  ('boj','Bank of Japan','central_bank',1,0.95,'JP','https://www.boj.or.jp'),
  ('pboc','Peoples Bank of China','central_bank',2,0.85,'CN','http://www.pbc.gov.cn'),
  ('eurostat','Eurostat','nso',1,0.93,'EU','https://ec.europa.eu/eurostat'),
  ('ons_uk','UK Office for National Statistics','nso',1,0.93,'UK','https://www.ons.gov.uk'),
  ('bis','Bank for International Settlements','central_bank',1,0.95,'GLOBAL','https://www.bis.org'),
  ('oecd','OECD','un',1,0.92,'GLOBAL','https://www.oecd.org')
ON CONFLICT (publisher_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.entity_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid,
  scheme text NOT NULL,
  identifier text NOT NULL,
  source text,
  evidence_url text,
  confidence numeric DEFAULT 0.9,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheme, identifier)
);
CREATE INDEX IF NOT EXISTS idx_eid_entity ON public.entity_identifiers (entity_id);
CREATE INDEX IF NOT EXISTS idx_eid_scheme ON public.entity_identifiers (scheme);
GRANT SELECT ON public.entity_identifiers TO anon, authenticated;
GRANT ALL ON public.entity_identifiers TO service_role;
ALTER TABLE public.entity_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eid_public_read" ON public.entity_identifiers FOR SELECT USING (true);
CREATE POLICY "eid_service_all" ON public.entity_identifiers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.entity_link_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_link_id uuid,
  source text NOT NULL,
  evidence_url text,
  evidence_quote text,
  confidence numeric DEFAULT 0.7,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elp_link ON public.entity_link_provenance (entity_link_id);
GRANT SELECT ON public.entity_link_provenance TO anon, authenticated;
GRANT ALL ON public.entity_link_provenance TO service_role;
ALTER TABLE public.entity_link_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "elp_public_read" ON public.entity_link_provenance FOR SELECT USING (true);
CREATE POLICY "elp_service_all" ON public.entity_link_provenance FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $do$ BEGIN
  IF to_regclass('public.entity_aliases') IS NOT NULL THEN
    BEGIN ALTER TABLE public.entity_aliases ADD COLUMN IF NOT EXISTS alias_source text; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.entity_aliases ADD COLUMN IF NOT EXISTS alias_language text; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE public.entity_aliases ADD COLUMN IF NOT EXISTS alias_authority text; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $do$;

CREATE TABLE IF NOT EXISTS public.deprecated_tables (
  table_name text PRIMARY KEY,
  replacement text NOT NULL,
  deprecated_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  removal_target_date date
);
GRANT SELECT ON public.deprecated_tables TO anon, authenticated;
GRANT ALL ON public.deprecated_tables TO service_role;
ALTER TABLE public.deprecated_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dep_public_read" ON public.deprecated_tables FOR SELECT USING (true);
CREATE POLICY "dep_service_all" ON public.deprecated_tables FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.deprecated_tables(table_name, replacement, reason, removal_target_date) VALUES
  ('metrics','normalized_metrics','Stale legacy slice (9 countries, 5 sources). Use normalized_metrics as canonical layer.', (now()+interval '180 days')::date)
ON CONFLICT (table_name) DO NOTHING;

DO $do$ BEGIN
  IF to_regclass('public.metrics') IS NOT NULL THEN
    EXECUTE 'COMMENT ON TABLE public.metrics IS ''DEPRECATED — replaced by normalized_metrics. See deprecated_tables registry.''';
  END IF;
END $do$;
