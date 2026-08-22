-- Persist temporal topology so AICIS can reason about structural change over time.

CREATE TABLE IF NOT EXISTS public.aicis_graph_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  node_count int NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  edge_count int NOT NULL DEFAULT 0 CHECK (edge_count >= 0),
  component_count int NOT NULL DEFAULT 0 CHECK (component_count >= 0),
  largest_component_size int NOT NULL DEFAULT 0 CHECK (largest_component_size >= 0),
  cycle_count int NOT NULL DEFAULT 0 CHECK (cycle_count >= 0),
  topology_hash text,
  source text NOT NULL DEFAULT 'cognitive-topology-scan',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aicis_graph_snapshots_captured_idx
  ON public.aicis_graph_snapshots (captured_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS aicis_graph_snapshots_hash_idx
  ON public.aicis_graph_snapshots (topology_hash)
  WHERE topology_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.aicis_graph_node_snapshots (
  snapshot_id uuid NOT NULL REFERENCES public.aicis_graph_snapshots(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.aicis_world_entities(id) ON DELETE CASCADE,
  degree_centrality numeric NOT NULL DEFAULT 0 CHECK (degree_centrality >= 0 AND degree_centrality <= 1),
  influence numeric NOT NULL DEFAULT 0 CHECK (influence >= 0 AND influence <= 1),
  outgoing_edges int NOT NULL DEFAULT 0 CHECK (outgoing_edges >= 0),
  incoming_edges int NOT NULL DEFAULT 0 CHECK (incoming_edges >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, entity_id)
);

CREATE INDEX IF NOT EXISTS aicis_graph_node_snapshots_entity_idx
  ON public.aicis_graph_node_snapshots (entity_id, snapshot_id);

CREATE TABLE IF NOT EXISTS public.aicis_topology_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_snapshot_id uuid REFERENCES public.aicis_graph_snapshots(id) ON DELETE SET NULL,
  current_snapshot_id uuid NOT NULL REFERENCES public.aicis_graph_snapshots(id) ON DELETE CASCADE,
  change_kind text NOT NULL CHECK (change_kind IN (
    'node.emerged','node.disappeared','connector.emerged','connector.weakened',
    'influence.surge','influence.drop','cluster.merged','cluster.fragmented',
    'feedback.emerged','feedback.disappeared'
  )),
  entity_id uuid REFERENCES public.aicis_world_entities(id) ON DELETE SET NULL,
  severity numeric NOT NULL CHECK (severity >= 0 AND severity <= 1),
  previous_value numeric,
  current_value numeric,
  delta numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aicis_topology_changes_recent_idx
  ON public.aicis_topology_changes (created_at DESC, severity DESC);
CREATE INDEX IF NOT EXISTS aicis_topology_changes_entity_idx
  ON public.aicis_topology_changes (entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;

ALTER TABLE public.aicis_graph_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_graph_node_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aicis_topology_changes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.aicis_graph_snapshots, public.aicis_graph_node_snapshots,
  public.aicis_topology_changes TO authenticated;
GRANT ALL ON public.aicis_graph_snapshots, public.aicis_graph_node_snapshots,
  public.aicis_topology_changes TO service_role;

CREATE POLICY "Operators inspect graph snapshots"
  ON public.aicis_graph_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect graph node snapshots"
  ON public.aicis_graph_node_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "Operators inspect topology changes"
  ON public.aicis_topology_changes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'operator'::app_role));

CREATE POLICY "Service role manages graph snapshots"
  ON public.aicis_graph_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages graph node snapshots"
  ON public.aicis_graph_node_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages topology changes"
  ON public.aicis_topology_changes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.aicis_recent_topology_changes AS
SELECT
  c.id,
  c.change_kind,
  c.entity_id,
  e.canonical_name AS entity_name,
  e.entity_type,
  c.severity,
  c.previous_value,
  c.current_value,
  c.delta,
  c.evidence,
  c.created_at,
  c.current_snapshot_id
FROM public.aicis_topology_changes c
LEFT JOIN public.aicis_world_entities e ON e.id = c.entity_id
WHERE c.created_at >= now() - interval '30 days'
ORDER BY c.severity DESC, c.created_at DESC;

GRANT SELECT ON public.aicis_recent_topology_changes TO authenticated, service_role;
