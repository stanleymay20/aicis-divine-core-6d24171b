
-- 1. Enable trigram extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Create enums
CREATE TYPE public.entity_type AS ENUM (
  'company', 'country', 'city', 'person', 'asset', 
  'product', 'event', 'policy', 'sector', 'commodity'
);

CREATE TYPE public.entity_alias_type AS ENUM (
  'name', 'ticker', 'lei', 'registry_id', 'iso_code', 
  'fips', 'osm_id', 'abbreviation', 'acronym', 'isin', 'cusip', 'duns'
);

CREATE TYPE public.entity_link_type AS ENUM (
  'subsidiary', 'parent', 'headquartered_in', 'operates_in', 
  'trades_in', 'supplies', 'competes_with', 'regulates', 
  'member_of', 'borders', 'capital_of'
);

-- 3. Canonical entities
CREATE TABLE public.canonical_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type public.entity_type NOT NULL,
  canonical_name TEXT NOT NULL,
  display_name TEXT,
  iso3 TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  trust_score NUMERIC(4,2) DEFAULT 0.50,
  source_count INT DEFAULT 1,
  last_resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ce_type ON public.canonical_entities(entity_type);
CREATE INDEX idx_ce_name ON public.canonical_entities USING gin(canonical_name gin_trgm_ops);
CREATE INDEX idx_ce_iso3 ON public.canonical_entities(iso3);

-- 4. Entity aliases
CREATE TABLE public.entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.canonical_entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_type public.entity_alias_type NOT NULL DEFAULT 'name',
  source TEXT,
  confidence NUMERIC(4,3) DEFAULT 1.000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ea_entity ON public.entity_aliases(entity_id);
CREATE INDEX idx_ea_alias ON public.entity_aliases USING gin(alias gin_trgm_ops);
CREATE UNIQUE INDEX idx_ea_unique ON public.entity_aliases(entity_id, alias, alias_type);

-- 5. Entity links
CREATE TABLE public.entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id UUID NOT NULL REFERENCES public.canonical_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.canonical_entities(id) ON DELETE CASCADE,
  link_type public.entity_link_type NOT NULL,
  strength NUMERIC(4,3) DEFAULT 1.000,
  source TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_link CHECK (source_entity_id != target_entity_id)
);

CREATE INDEX idx_el_source ON public.entity_links(source_entity_id);
CREATE INDEX idx_el_target ON public.entity_links(target_entity_id);
CREATE INDEX idx_el_type ON public.entity_links(link_type);

-- 6. External IDs
CREATE TABLE public.entity_external_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.canonical_entities(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_type TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_exi_unique ON public.entity_external_ids(provider, external_id);
CREATE INDEX idx_exi_entity ON public.entity_external_ids(entity_id);

-- 7. Merge audit log
CREATE TABLE public.entity_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_id UUID NOT NULL REFERENCES public.canonical_entities(id),
  loser_id UUID,
  merge_reason TEXT NOT NULL,
  merged_by TEXT DEFAULT 'system',
  merge_confidence NUMERIC(4,3),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Immutability
CREATE OR REPLACE FUNCTION public.prevent_entity_merge_log_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'entity_merge_log is immutable';
END;
$$;

CREATE TRIGGER trg_entity_merge_log_immutable
BEFORE UPDATE OR DELETE ON public.entity_merge_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_entity_merge_log_mutation();

-- 9. Updated_at triggers
CREATE TRIGGER update_canonical_entities_updated_at
BEFORE UPDATE ON public.canonical_entities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_entity_links_updated_at
BEFORE UPDATE ON public.entity_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. RLS
ALTER TABLE public.canonical_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_merge_log ENABLE ROW LEVEL SECURITY;

-- Read policies
CREATE POLICY "auth_read_entities" ON public.canonical_entities FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_aliases" ON public.entity_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_links" ON public.entity_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_ext_ids" ON public.entity_external_ids FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read_merge_log" ON public.entity_merge_log FOR SELECT TO authenticated USING (true);

-- Admin write policies
CREATE POLICY "admin_manage_entities" ON public.canonical_entities FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "admin_manage_aliases" ON public.entity_aliases FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "admin_manage_links" ON public.entity_links FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "admin_manage_ext_ids" ON public.entity_external_ids FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "admin_insert_merge_log" ON public.entity_merge_log FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- Service role
CREATE POLICY "sr_entities" ON public.canonical_entities FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "sr_aliases" ON public.entity_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "sr_links" ON public.entity_links FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "sr_ext_ids" ON public.entity_external_ids FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "sr_merge_log" ON public.entity_merge_log FOR ALL TO service_role USING (true) WITH CHECK (true);
