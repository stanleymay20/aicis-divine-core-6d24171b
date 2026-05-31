import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Database, GitBranch, ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SummaryTile } from "@/components/data-pipeline/SummaryTile";
import { ChainIntegrityCard } from "@/components/data-pipeline/ChainIntegrityCard";
import { RunHealthCard } from "@/components/data-pipeline/RunHealthCard";
import { FreshnessCard } from "@/components/data-pipeline/FreshnessCard";
import { OrphanRegionsCard } from "@/components/data-pipeline/OrphanRegionsCard";
import { SeedRetryCard } from "@/components/data-pipeline/SeedRetryCard";
import { useFreshness, useOrphans, useRunHealth, useSeedStatus, useChain } from "@/components/data-pipeline/queries";

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

  const freshness = useFreshness(isPrivileged);
  const orphans = useOrphans(isPrivileged);
  const runHealth = useRunHealth(isPrivileged);
  const seedStatus = useSeedStatus(isPrivileged);
  const chain = useChain(isPrivileged);

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryTile icon={<Activity className="h-4 w-4" />} label="Countries with L0" value={summary.total} />
        <SummaryTile icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} label="Fresh (<24h)" value={summary.fresh} />
        <SummaryTile icon={<Clock className="h-4 w-4 text-amber-400" />} label="Aging (1-7d)" value={summary.aging} />
        <SummaryTile icon={<AlertTriangle className="h-4 w-4 text-rose-400" />} label="Stale (>7d)" value={summary.stale + summary.never} />
        <SummaryTile icon={<GitBranch className="h-4 w-4" />} label="Rows written 24h" value={summary.rows_24h.toLocaleString()} />
      </div>

      <PanelBoundary><ChainIntegrityCard loading={chain.isLoading} summary={chainSummary} /></PanelBoundary>
      <PanelBoundary><RunHealthCard loading={runHealth.isLoading} rows={runHealth.data} /></PanelBoundary>
      <PanelBoundary>
        <FreshnessCard
          loading={freshness.isLoading}
          rows={freshness.data}
          filtered={filtered}
          filter={filter}
          onFilterChange={setFilter}
        />
      </PanelBoundary>
      <PanelBoundary><OrphanRegionsCard loading={orphans.isLoading} rows={orphans.data} /></PanelBoundary>
      <PanelBoundary><SeedRetryCard loading={seedStatus.isLoading} rows={seedStatus.data} /></PanelBoundary>
    </div>
  );
}
