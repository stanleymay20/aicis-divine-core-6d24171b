import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRoutingPrecision, useConnectorHealth, useEnrichmentQueue } from "@/hooks/useRoutingPrecision";
import { CheckCircle2, XCircle, HelpCircle, Activity, Clock, AlertTriangle, Database } from "lucide-react";

function PrecisionBar({ label, rate, total }: { label: string; rate: number; total: number }) {
  const color = rate >= 80 ? "bg-emerald-500" : rate >= 60 ? "bg-yellow-500" : rate >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground truncate">{label}</span>
        <span className="font-mono font-bold">{rate}% <span className="text-muted-foreground font-normal">({total})</span></span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

export function RoutingPrecisionPanel() {
  const { data: precision, isLoading } = useRoutingPrecision();
  const { data: connectorRuns } = useConnectorHealth();
  const { data: pendingCount } = useEnrichmentQueue();

  if (isLoading || !precision) return null;

  const lastRun = connectorRuns?.[0];
  const lastRunTime = lastRun ? new Date(lastRun.run_at).toLocaleTimeString() : "—";
  const failedRuns = connectorRuns?.filter(r => r.run_status !== "success").length || 0;

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold flex items-center gap-1">
          <Activity className="h-3.5 w-3.5 text-primary" /> Routing Precision
        </h3>
        {precision.total > 0 && (
          <Badge variant="outline" className={cn(
            "text-[9px] h-4",
            precision.confirmRate >= 70 ? "border-emerald-500/30 text-emerald-400" :
            precision.confirmRate >= 50 ? "border-yellow-500/30 text-yellow-400" :
            "border-red-500/30 text-red-400"
          )}>
            {precision.confirmRate}% confirm rate
          </Badge>
        )}
      </div>

      {precision.total === 0 ? (
        <p className="text-[10px] text-muted-foreground">No routing feedback yet. Review signals to build precision metrics.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-sm font-bold text-emerald-400 font-mono">{precision.confirmed}</div>
              <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                <CheckCircle2 className="h-2.5 w-2.5" /> Confirmed
              </div>
            </div>
            <div>
              <div className="text-sm font-bold text-red-400 font-mono">{precision.rejected}</div>
              <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                <XCircle className="h-2.5 w-2.5" /> Rejected
              </div>
            </div>
            <div>
              <div className="text-sm font-bold text-yellow-400 font-mono">{precision.unclear}</div>
              <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                <HelpCircle className="h-2.5 w-2.5" /> Unclear
              </div>
            </div>
          </div>

          {/* By Tier */}
          {Object.keys(precision.byTier).length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[10px] text-muted-foreground font-semibold">By Source Tier</h4>
              {Object.entries(precision.byTier).map(([tier, stats]) => (
                <PrecisionBar key={tier} label={tier.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())} rate={stats.rate} total={stats.total} />
              ))}
            </div>
          )}

          {/* Top categories */}
          {Object.keys(precision.byCategory).length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[10px] text-muted-foreground font-semibold">By Category (top 5)</h4>
              {Object.entries(precision.byCategory)
                .sort((a, b) => b[1].total - a[1].total)
                .slice(0, 5)
                .map(([cat, stats]) => (
                  <PrecisionBar key={cat} label={cat.replace("_", " ")} rate={stats.rate} total={stats.total} />
                ))}
            </div>
          )}
        </>
      )}

      {/* Operational Health */}
      <div className="border-t pt-2 space-y-1">
        <h4 className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
          <Database className="h-2.5 w-2.5" /> Engine Health
        </h4>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pending enrichment</span>
            <span className={cn("font-mono font-bold", (pendingCount || 0) > 5 ? "text-amber-400" : "text-emerald-400")}>
              {pendingCount || 0}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last ingest</span>
            <span className="font-mono">{lastRunTime}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Failed runs</span>
            <span className={cn("font-mono font-bold", failedRuns > 0 ? "text-red-400" : "text-emerald-400")}>
              {failedRuns}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Recent runs</span>
            <span className="font-mono">{connectorRuns?.length || 0}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
