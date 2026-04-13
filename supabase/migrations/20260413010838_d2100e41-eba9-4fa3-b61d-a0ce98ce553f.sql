
-- Unique constraints for idempotent link upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_metric_links_unique 
  ON entity_metric_links(metric_id, entity_id, link_role);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_event_links_unique 
  ON entity_event_links(event_id, entity_id, link_role);
