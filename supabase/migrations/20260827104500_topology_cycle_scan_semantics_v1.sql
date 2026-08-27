-- AICIS topology cycle-scan semantics.
-- The topology scanner performs a bounded directed-cycle search. Its cycle_count
-- is therefore a detected-count under declared limits, not necessarily the total
-- number of cycles in the graph.

ALTER TABLE public.aicis_graph_snapshots
  ADD COLUMN IF NOT EXISTS cycle_count_semantics text,
  ADD COLUMN IF NOT EXISTS cycle_scan_max_depth integer CHECK (
    cycle_scan_max_depth IS NULL OR cycle_scan_max_depth >= 1
  ),
  ADD COLUMN IF NOT EXISTS cycle_scan_max_cycles integer CHECK (
    cycle_scan_max_cycles IS NULL OR cycle_scan_max_cycles >= 1
  ),
  ADD COLUMN IF NOT EXISTS cycle_scan_capped boolean;

UPDATE public.aicis_graph_snapshots
SET cycle_count_semantics = 'legacy_cycle_count_semantics_unverified'
WHERE cycle_count_semantics IS NULL AND cycle_count IS NOT NULL;

COMMENT ON COLUMN public.aicis_graph_snapshots.cycle_count IS
  'Detected directed-cycle count under the scanner limits recorded beside the snapshot; it must not be interpreted as an exhaustive total when cycle_scan_capped is true or semantics are legacy.';
