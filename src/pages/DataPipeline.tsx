import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  GitBranch,
  Repeat,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";

type FreshnessRow = {
  country_iso3: string;
  regions_with_data: number;
  village_rows: number;
  rows_24h: number;
  rows_7d: number;
  last_observed_at: string | null;
  hours_since_last: number | null;
  freshness_status: "fresh" | "aging" | "stale" | "never";
};
type OrphanRow = {
  admin_level: number;
  missing_iso3: number;
  missing_parent: number;
  missing_centroid: number;
  missing_population: number;
};
type RunHealthRow = {
  function_name: string;
  runs_24h: number;
  ok_24h: number;
  zero_24h: number;
  failed_24h: number;
  rows_written_24h: number;
  last_run_at: string | null;
  three_consecutive_failures: boolean;
};
type ChainRow = {
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
type SeedRow = {
  country_iso3: string;
  best_villages_found: number | null;
  retry_count: number | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
  retry_state: "seeded" | "abandoned" | "due" | "scheduled";
};

const STATUS_COLORS: Record<string, string> = {
  fresh: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  aging: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  stale: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  never: "bg-muted text-muted-foreground border-border",
};
const SEED_COLORS: Record<string, string> = {
  seeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  due: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  scheduled: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  abandoned: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export default function DataPipeline() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("");

  const roles = useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user!.id);
      return (data ?? []).map((r) => r.role as string);
    },
  });
  const isPrivileged = !!roles.data?.some((r) => r === "admin" || r === "operator");

  const freshness = useQuery({
    queryKey: ["dq-village-layer-health"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dq_village_layer_health" as any)
        .select("*")
        .order("hours_since_last", { ascending: false, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as unknown as FreshnessRow[];
    },
  });

  const orphans = useQuery({
    queryKey: ["dq-orphan-regions"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data, error } = await supabase.from("dq_orphan_regions" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as OrphanRow[];
    },
  });

  const runHealth = useQuery({
    queryKey: ["dq-inference-run-health"],
    enabled: isPrivileged,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("dq_inference_run_health" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as RunHealthRow[];
    },
  });

  const seedStatus = useQuery({
    queryKey: ["dq-seed-retry-status"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dq_seed_retry_status" as any)
        .select("*")
        .order("next_retry_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as SeedRow[];
    },
  });

  const chain = useQuery({
    queryKey: ["v-local-to-national-freshness"],
    enabled: isPrivileged,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_local_to_national_freshness" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as unknown as ChainRow[];
    },
  });

  const chainSummary = useMemo(() => {
    const c = chain.data ?? [];
    const by: Record<string, number> = {};
    for (const r of c) by[r.chain_status] = (by[r.chain_status] ?? 0) + 1;
    return { total: c.length, by };
  }, [chain.data]);

  const summary = useMemo(() => {
    const f = freshness.data ?? [];
    return {
      total: f.length,
      fresh: f.filter((r) => r.freshness_status === "fresh").length,
      aging: f.filter((r) => r.freshness_status === "aging").length,
      stale: f.filter((r) => r.freshness_status === "stale").length,
      never: f.filter((r) => r.freshness_status === "never").length,
      rows_24h: f.reduce((a, r) => a + (r.rows_24h ?? 0), 0),
    };
  }, [freshness.data]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = freshness.data ?? [];
    if (!q) return list;
    return list.filter((r) => r.country_iso3?.toLowerCase().includes(q));
  }, [freshness.data, filter]);

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">Sign in required.</p>
      </div>
    );
  }
  if (!isPrivileged) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Admin or operator role required.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          Data Pipeline — Truth Floor
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          L0 (village) → L1/L2 freshness, inference run health, orphan regions and seed retry queue.
          All values derived live from the database. No fabrication.
        </p>
      </div>

      {/* ─── Summary tiles ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryTile icon={<Activity className="h-4 w-4" />} label="Countries with L0" value={summary.total} />
        <SummaryTile icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} label="Fresh (<24h)" value={summary.fresh} />
        <SummaryTile icon={<Clock className="h-4 w-4 text-amber-400" />} label="Aging (1-7d)" value={summary.aging} />
        <SummaryTile icon={<AlertTriangle className="h-4 w-4 text-rose-400" />} label="Stale (>7d)" value={summary.stale + summary.never} />
        <SummaryTile icon={<GitBranch className="h-4 w-4" />} label="Rows written 24h" value={summary.rows_24h.toLocaleString()} />
      </div>

      {/* ─── Inference run health ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Inference Run Health (24h)
          </CardTitle>
          <CardDescription>
            Every inference run leaves a record. Three consecutive failures or zero-writes triggers a red badge — Silent Failure Doctrine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runHealth.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (runHealth.data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 border border-dashed border-border rounded text-center">
              No inference runs recorded in the last 24h. Trigger a run or check pg_cron health.
            </div>
          ) : (
            <div className="space-y-2">
              {(runHealth.data ?? []).map((r) => (
                <div key={r.function_name} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-3 rounded-md border border-border bg-card/50">
                  <div className="min-w-0">
                    <div className="text-sm font-medium font-mono truncate">{r.function_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.runs_24h} runs · {r.rows_written_24h?.toLocaleString() ?? 0} rows · last{" "}
                      {r.last_run_at ? formatDistanceToNow(new Date(r.last_run_at), { addSuffix: true }) : "—"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                      {r.ok_24h} ok
                    </Badge>
                    {r.zero_24h > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-300 border-amber-500/30">
                        {r.zero_24h} zero-write
                      </Badge>
                    )}
                    {r.failed_24h > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-300 border-rose-500/30">
                        {r.failed_24h} failed
                      </Badge>
                    )}
                    {r.three_consecutive_failures && (
                      <Badge variant="destructive" className="text-[10px]">
                        <AlertTriangle className="h-3 w-3 mr-1" /> 3-strike
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Freshness per country ─── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                L0 Freshness per Country
              </CardTitle>
              <CardDescription>
                Stale-flagged countries (&gt; 7 days) are excluded from defensible national rollups.
              </CardDescription>
            </div>
            <Input
              placeholder="Filter ISO3…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 max-w-[200px] uppercase font-mono text-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          {freshness.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ScrollArea className="h-[420px] pr-2">
              <div className="space-y-1.5">
                {filtered.map((r) => (
                  <div key={r.country_iso3} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-card/40 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold w-12">{r.country_iso3}</span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[r.freshness_status]}`}>
                        {r.freshness_status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                      <span>{r.regions_with_data} regions</span>
                      <span>{r.village_rows?.toLocaleString()} rows</span>
                      <span className="hidden sm:inline">{r.rows_24h ?? 0} /24h</span>
                      <span className="hidden md:inline">
                        {r.last_observed_at
                          ? formatDistanceToNow(new Date(r.last_observed_at), { addSuffix: true })
                          : "never"}
                      </span>
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="text-sm text-muted-foreground p-4 text-center">No countries match.</div>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ─── Orphan regions ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            Orphan Regions (hierarchy integrity)
          </CardTitle>
          <CardDescription>
            Regions missing parent_id, centroid, ISO3, or population cannot participate in weighted rollups.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orphans.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-2">Admin Level</th>
                    <th className="text-right p-2">Missing ISO3</th>
                    <th className="text-right p-2">Missing Parent</th>
                    <th className="text-right p-2">Missing Centroid</th>
                    <th className="text-right p-2">Missing Population</th>
                  </tr>
                </thead>
                <tbody>
                  {(orphans.data ?? []).map((r) => (
                    <tr key={r.admin_level} className="border-b border-border/40">
                      <td className="p-2 font-mono">L{r.admin_level}</td>
                      <td className="p-2 text-right">{r.missing_iso3}</td>
                      <td className="p-2 text-right">{r.missing_parent}</td>
                      <td className="p-2 text-right">{r.missing_centroid}</td>
                      <td className="p-2 text-right">{r.missing_population}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Seed retry queue ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Repeat className="h-4 w-4 text-primary" />
            Seed Retry Queue
          </CardTitle>
          <CardDescription>
            Countries with zero villages get exponential-backoff retries. The daily{" "}
            <span className="font-mono">seed-retry-zero-result</span> job picks up due rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {seedStatus.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ScrollArea className="h-[300px] pr-2">
              <div className="space-y-1">
                {(seedStatus.data ?? []).map((r) => (
                  <div key={r.country_iso3} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-card/40 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold w-12">{r.country_iso3}</span>
                      <Badge variant="outline" className={`text-[10px] ${SEED_COLORS[r.retry_state]}`}>
                        {r.retry_state}
                      </Badge>
                      {(r.retry_count ?? 0) > 0 && (
                        <span className="text-muted-foreground">retry #{r.retry_count}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                      <span className="hidden sm:inline">
                        last:{" "}
                        {r.last_attempt_at
                          ? formatDistanceToNow(new Date(r.last_attempt_at), { addSuffix: true })
                          : "—"}
                      </span>
                      <span>
                        next:{" "}
                        {r.next_retry_at
                          ? formatDistanceToNow(new Date(r.next_retry_at), { addSuffix: true })
                          : "—"}
                      </span>
                    </div>
                  </div>
                ))}
                {(seedStatus.data ?? []).length === 0 && (
                  <div className="text-sm text-muted-foreground p-4 text-center">
                    No seed attempts on record.
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card className="border-border bg-card/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wide">
          {icon} {label}
        </div>
        <div className="text-xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
