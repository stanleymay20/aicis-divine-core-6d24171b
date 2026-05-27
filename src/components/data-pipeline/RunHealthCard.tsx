import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle } from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { formatDistanceToNow } from "date-fns";
import type { RunHealthRow } from "./types";

export function RunHealthCard({ loading, rows }: { loading: boolean; rows: RunHealthRow[] | undefined }) {
  return (
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
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (rows ?? []).length === 0 ? (
          <PanelEmpty
            title="No inference runs in last 24h"
            reason="dq_inference_run_health logs every model/forecast inference call. Either pg_cron is paused or no edge function fired in this window."
            nextStep="Check pg_cron health in Operations Backplane, or invoke an inference manually from /intelligence-engine."
            compact
          />
        ) : (
          <div className="space-y-2">
            {(rows ?? []).map((r) => (
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
  );
}
