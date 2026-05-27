export type FreshnessRow = {
  country_iso3: string;
  regions_with_data: number;
  village_rows: number;
  rows_24h: number;
  rows_7d: number;
  last_observed_at: string | null;
  hours_since_last: number | null;
  freshness_status: "fresh" | "aging" | "stale" | "never";
};
export type OrphanRow = {
  admin_level: number;
  missing_iso3: number;
  missing_parent: number;
  missing_centroid: number;
  missing_population: number;
};
export type RunHealthRow = {
  function_name: string;
  runs_24h: number;
  ok_24h: number;
  zero_24h: number;
  failed_24h: number;
  rows_written_24h: number;
  last_run_at: string | null;
  three_consecutive_failures: boolean;
};
export type ChainRow = {
  country_iso3: string;
  last_national: string | null;
  last_l0: string | null;
  last_community: string | null;
  last_urban: string | null;
  regions: number | null;
  regions_with_pop: number | null;
  chain_status:
    | "healthy"
    | "no_local_anchor"
    | "no_population_data"
    | "no_community_metrics"
    | "no_village_indicators"
    | "no_national_snapshot"
    | "community_stale"
    | "village_stale";
};
export type SeedRow = {
  country_iso3: string;
  best_villages_found: number | null;
  retry_count: number | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
  retry_state: "seeded" | "abandoned" | "due" | "scheduled";
};

export const STATUS_COLORS: Record<string, string> = {
  fresh: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  aging: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  stale: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  never: "bg-muted text-muted-foreground border-border",
};
export const SEED_COLORS: Record<string, string> = {
  seeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  due: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  scheduled: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  abandoned: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
