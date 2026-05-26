import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, PauseCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PanelBoundary } from "@/components/ui/panel-boundary";

type SloRow = {
  pipeline_name: string;
  schedule: string | null;
  enabled: boolean;
  ok_24h: number;
  fail_24h: number;
  last_success_at: string | null;
  last_failure_at: string | null;
};

type CatalogRow = {
  id: string;
  name: string;
  kind: string;
  schedule: string | null;
  owner: string | null;
  criticality: string;
  description: string | null;
  enabled: boolean;
};

function statusFor(r: SloRow): { label: string; tone: "ok" | "warn" | "down" | "idle" } {
  if (!r.enabled) return { label: "disabled", tone: "idle" };
  const total = r.ok_24h + r.fail_24h;
  if (total === 0) return { label: "no runs 24h", tone: "warn" };
  const failRate = r.fail_24h / total;
  if (failRate >= 0.5) return { label: `failing ${r.fail_24h}/${total}`, tone: "down" };
  if (failRate > 0) return { label: `degraded ${r.fail_24h}/${total}`, tone: "warn" };
  return { label: `healthy ${r.ok_24h}`, tone: "ok" };
}

const toneClass: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  down: "bg-red-500/15 text-red-300 border-red-500/30",
  idle: "bg-muted text-muted-foreground border-border",
};

export default function SystemCatalog() {
  const slo = useQuery({
    queryKey: ["system_slo_recent_v"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_slo_recent_v" as any)
        .select("*")
        .order("fail_24h", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SloRow[];
    },
    staleTime: 30_000,
  });

  const catalog = useQuery({
    queryKey: ["system_service_catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_service_catalog" as any)
        .select("*")
        .order("criticality", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CatalogRow[];
    },
    staleTime: 60_000,
  });

  const rows = slo.data ?? [];
  const failing = rows.filter((r) => r.fail_24h > 0 && r.enabled);
  const healthy = rows.filter((r) => r.fail_24h === 0 && r.ok_24h > 0 && r.enabled);
  const idle = rows.filter((r) => r.ok_24h + r.fail_24h === 0 && r.enabled);
  const disabled = rows.filter((r) => !r.enabled);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">System Catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live operational truth for every cron pipeline and registered service. Read-only.
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PanelBoundary><SummaryTile label="Healthy" value={healthy.length} tone="ok" Icon={CheckCircle2} /></PanelBoundary>
          <PanelBoundary><SummaryTile label="Failing/Degraded" value={failing.length} tone="down" Icon={AlertTriangle} /></PanelBoundary>
          <PanelBoundary><SummaryTile label="Idle 24h" value={idle.length} tone="warn" Icon={AlertTriangle} /></PanelBoundary>
          <PanelBoundary><SummaryTile label="Disabled" value={disabled.length} tone="idle" Icon={PauseCircle} /></PanelBoundary>
        </div>

        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-3">Cron pipelines (last 24h)</h2>
          {slo.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : slo.error ? (
            <p className="text-sm text-destructive">Failed to load SLO data.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cron jobs registered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 pr-3">Pipeline</th>
                    <th className="text-left py-2 pr-3 hidden sm:table-cell">Schedule</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-left py-2 pr-3 hidden md:table-cell">Last success</th>
                    <th className="text-left py-2 pr-3 hidden md:table-cell">Last failure</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = statusFor(r);
                    return (
                      <tr key={r.pipeline_name} className="border-b border-border/50">
                        <td className="py-2 pr-3 font-mono text-xs">{r.pipeline_name}</td>
                        <td className="py-2 pr-3 hidden sm:table-cell text-muted-foreground font-mono text-xs">{r.schedule}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className={toneClass[s.tone]}>{s.label}</Badge>
                        </td>
                        <td className="py-2 pr-3 hidden md:table-cell text-muted-foreground text-xs">
                          {r.last_success_at ? formatDistanceToNow(new Date(r.last_success_at), { addSuffix: true }) : "—"}
                        </td>
                        <td className="py-2 pr-3 hidden md:table-cell text-muted-foreground text-xs">
                          {r.last_failure_at ? formatDistanceToNow(new Date(r.last_failure_at), { addSuffix: true }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-3">Service registry</h2>
          {catalog.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (catalog.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No services registered yet. Admins can register edge functions, RPCs, and crons in <code>system_service_catalog</code> to formalise ownership and criticality.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 pr-3">Name</th>
                    <th className="text-left py-2 pr-3">Kind</th>
                    <th className="text-left py-2 pr-3 hidden sm:table-cell">Owner</th>
                    <th className="text-left py-2 pr-3">Criticality</th>
                    <th className="text-left py-2 pr-3 hidden md:table-cell">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {(catalog.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono text-xs">{r.name}</td>
                      <td className="py-2 pr-3"><Badge variant="outline">{r.kind}</Badge></td>
                      <td className="py-2 pr-3 hidden sm:table-cell text-muted-foreground">{r.owner ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={r.criticality === "critical" ? toneClass.down : r.criticality === "high" ? toneClass.warn : toneClass.idle}>
                          {r.criticality}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 hidden md:table-cell text-muted-foreground text-xs">{r.description ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone, Icon }: { label: string; value: number; tone: "ok" | "warn" | "down" | "idle"; Icon: typeof CheckCircle2 }) {
  return (
    <Card className={`p-3 sm:p-4 border ${toneClass[tone]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide opacity-80">{label}</span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}
