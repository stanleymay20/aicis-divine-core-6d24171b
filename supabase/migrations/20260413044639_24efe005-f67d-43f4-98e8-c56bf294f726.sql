-- Unique constraint for canonical_entities upsert by entity_type + normalized_name
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_entities_type_normalized 
  ON canonical_entities (entity_type, normalized_name);

-- Unique constraint for entity_aliases
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_aliases_unique 
  ON entity_aliases (entity_id, alias, alias_type);

-- Unique constraint for entity_external_ids
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_external_ids_unique 
  ON entity_external_ids (entity_id, provider, external_id);

-- Unique constraint for entity_links
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_links_unique 
  ON entity_links (source_entity_id, target_entity_id, link_type);

-- Unique constraint for entity_metric_links
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_metric_links_unique 
  ON entity_metric_links (metric_id, entity_id, link_role);