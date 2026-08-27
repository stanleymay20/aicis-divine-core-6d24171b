-- AICIS topology metric truth floor v2.
--
-- Degree centrality and edge counts are deterministic properties of a captured
-- graph. Weighted influence requires explicit quantitative edge semantics and may
-- be unknown. Topology change severity is a prioritization heuristic, not a
-- probability or calibrated confidence.

ALTER TABLE public.aicis_graph_node_snapshots
  ALTER COLUMN influence DROP DEFAULT,
  ALTER COLUMN influence DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS influence_semantics text,
  ADD COLUMN IF NOT EXISTS influence_coverage numeric CHECK (
    influence_coverage IS NULL OR (influence_coverage >= 0 AND influence_coverage <= 1)
  ),
  ADD COLUMN IF NOT EXISTS degree_centrality_semantics text;

UPDATE public.aicis_graph_node_snapshots
SET
  influence_semantics = COALESCE(influence_semantics, 'legacy_influence_semantics_unverified'),
  degree_centrality_semantics = COALESCE(degree_centrality_semantics, 'deterministic_verified_graph_degree_centrality')
WHERE influence_semantics IS NULL OR degree_centrality_semantics IS NULL;

ALTER TABLE public.aicis_topology_changes
  ALTER COLUMN severity DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS severity_semantics text,
  ADD COLUMN IF NOT EXISTS metric_semantics text;

UPDATE public.aicis_topology_changes
SET
  severity_semantics = COALESCE(severity_semantics, 'legacy_topology_priority_semantics_unverified'),
  metric_semantics = COALESCE(metric_semantics, 'legacy_topology_metric_semantics_unverified')
WHERE severity_semantics IS NULL OR metric_semantics IS NULL;

COMMENT ON COLUMN public.aicis_graph_node_snapshots.degree_centrality IS
  'Deterministic normalized degree on the captured verified graph; inspect degree_centrality_semantics for graph-scope details.';
COMMENT ON COLUMN public.aicis_graph_node_snapshots.influence IS
  'Nullable weighted graph influence heuristic. NULL means the required quantitative edge inputs were incomplete; inspect influence_semantics and influence_coverage.';
COMMENT ON COLUMN public.aicis_graph_node_snapshots.influence_coverage IS
  'Fraction of incident/outgoing weighted inputs eligible for the influence calculation under declared semantics; not confidence.';
COMMENT ON COLUMN public.aicis_topology_changes.severity IS
  'Nullable deterministic operator-priority heuristic for a topology change; never a probability. Inspect severity_semantics.';

CREATE OR REPLACE VIEW public.aicis_recent_topology_changes AS
SELECT
  c.id,
  c.change_kind,
  c.entity_id,
  e.canonical_name AS entity_name,
  e.entity_type,
  c.severity,
  c.severity_semantics,
  c.metric_semantics,
  c.previous_value,
  c.current_value,
  c.delta,
  c.evidence,
  c.created_at,
  c.current_snapshot_id
FROM public.aicis_topology_changes c
LEFT JOIN public.aicis_world_entities e ON e.id = c.entity_id
WHERE c.created_at >= now() - interval '30 days'
ORDER BY c.severity DESC NULLS LAST, c.created_at DESC;

GRANT SELECT ON public.aicis_recent_topology_changes TO authenticated, service_role;
