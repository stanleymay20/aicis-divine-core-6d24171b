import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, GitBranch, PlayCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

type Freshness = {
  latest_snapshot: string | null;
  latest_built_at: string | null;
  total_rows: number | null;
  rows_last_24h: number | null;
  rows_last_7d: number | null;
  hours_since_last_build: number | null;
  days_snapshot_lag: number | null;
  latest_version: string | null;
  latest_version_at: string | null;
  latest_version_rows: number | null;
  latest_version_window_start: string | null;
  latest_version_window_end: string | null;
  last_execution_id: string | null;
  last_execution_status: string | null;
  last_execution_mode: string | null;
  last_execution_started_at: string | null;
  last_execution_completed_at: string | null;
  last_execution_records: number | null;
  last_execution_chunks_completed: number | null;
  last_execution_total_chunks: number | null;
  last_execution_failure_reason: string | null;
  last_successful_completion: string | null;
  freshness_status: "fresh" | "aging" | "stale" | "never";
};

const STATUS_STYLE: Record<string, string> = {
  fresh: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  aging: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  stale: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  never: "bg-muted text-muted-foreground border-border",
};

const EXEC_STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  running: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  timeout: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  partial: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return "—"; }
}

export function TrainingFreshnessPanel() {
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["training-freshness"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("training_freshness" as any).select("*").maybeSingle();
      if (error) throw error;
      return data as unknown as Freshness | null;
    },
  });

  const runIncremental = async () => {
    setBusy(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("build-training-dataset", {
        body: { mode: "incremental", lookback_days: 14, horizon_days: 7 },
      });
      if (error) throw error;
      const info = res as any;
      if (info?.execution_id) toast.success(`Training scheduled: ${info.execution_id}`);
      else toast.info(info?.message ?? "training already up to date");
      setTimeout(() => refetch(), 1500);
    } catch (e: any) {
      toast.error(`Training kickoff failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("build-training-dataset", {
        body: { mode: "resume" },
      });
      if (error) throw error;
      const info = res as any;
      if (info?.resumed) toast.success(`Resumed ${info.execution_id}`);
      else toast.info(info?.message ?? "nothing to resume");
      setTimeout(() => refetch(), 1500);
    } catch (e: any) {
      toast.error(`Resume failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading training freshness…</Card>;
  }
  if (!data) {
    return (
      <Card className="p-6 border-muted/40">
        <p className="text-sm text-muted-foreground">No training dataset yet. Run an incremental build to seed.</p>
        <Button size="sm" className="mt-3" onClick={runIncremental} disabled={busy}>
          <PlayCircle className="mr-2 h-4 w-4" /> Run incremental
        </Button>
      </Card>
    );
  }

  const statusStyle = STATUS_STYLE[data.freshness_status] ?? STATUS_STYLE.never;
  const execStyle = data.last_execution_status
    ? EXEC_STATUS_STYLE[data.last_execution_status] ?? "bg-muted text-muted-foreground border-border"
    : "bg-muted text-muted-foreground border-border";
  const progress =
    data.last_execution_total_chunks && data.last_execution_total_chunks > 0
      ? Math.round(((data.last_execution_chunks_completed ?? 0) / data.last_execution_total_chunks) * 100)
      : null;

  return (
    <Card className="p-6 border-primary/30 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          <div>
            <h2 className="text-lg font-semibold font-orbitron">Model Training Freshness</h2>
            <p className="text-xs text-muted-foreground">
              Incremental + chunked + resumable — Sweep #16
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("uppercase tracking-wider text-[10px]", statusStyle)}>
            {data.freshness_status}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={runIncremental} disabled={busy}>
            <PlayCircle className="mr-2 h-3.5 w-3.5" /> Run incremental
          </Button>
          {data.last_execution_status === "running" && (
            <Button size="sm" variant="secondary" onClick={resume} disabled={busy}>
              Resume
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Stat label="Latest snapshot" value={data.latest_snapshot ?? "—"} sub={data.days_snapshot_lag != null ? `${Number(data.days_snapshot_lag).toFixed(0)}d lag` : ""} />
        <Stat label="Last build" value={fmtAgo(data.latest_built_at)} sub={data.hours_since_last_build != null ? `${Number(data.hours_since_last_build).toFixed(1)}h` : ""} />
        <Stat label="Total rows" value={(data.total_rows ?? 0).toLocaleString()} sub={`+${(data.rows_last_24h ?? 0).toLocaleString()} 24h`} />
        <Stat label="Last 7d" value={(data.rows_last_7d ?? 0).toLocaleString()} sub="rows built" />
      </div>

      <div className="border-t border-border/40 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Latest dataset version</span>
          </div>
          {data.latest_version ? (
            <div className="space-y-1 text-sm">
              <div className="font-mono text-primary">{data.latest_version}</div>
              <div className="text-xs text-muted-foreground">
                {data.latest_version_window_start} → {data.latest_version_window_end} ·{" "}
                {(data.latest_version_rows ?? 0).toLocaleString()} rows · {fmtAgo(data.latest_version_at)}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No versioned dataset yet.</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last execution</span>
            {data.last_execution_status && (
              <Badge variant="outline" className={cn("text-[10px] uppercase", execStyle)}>
                {data.last_execution_status}
              </Badge>
            )}
          </div>
          {data.last_execution_id ? (
            <div className="space-y-1 text-xs">
              <div className="font-mono truncate">{data.last_execution_id}</div>
              <div className="text-muted-foreground">
                {data.last_execution_mode} · started {fmtAgo(data.last_execution_started_at)} ·{" "}
                {(data.last_execution_records ?? 0).toLocaleString()} records
              </div>
              {progress !== null && (
                <div className="text-muted-foreground">
                  Chunks {data.last_execution_chunks_completed}/{data.last_execution_total_chunks} ({progress}%)
                </div>
              )}
              {data.last_execution_failure_reason && (
                <div className="text-destructive truncate">⚠ {data.last_execution_failure_reason}</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No executions recorded.</div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Last successful build: {fmtAgo(data.last_successful_completion)}
      </div>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded-lg border border-border/40 bg-card/40">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-orbitron tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
