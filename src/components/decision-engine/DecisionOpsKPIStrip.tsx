import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  PlayCircle,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function DecisionOpsKPIStrip() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["decision-ops-kpi-strip"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();

      const [pending, overdue, active, done30, savings] = await Promise.all([
        supabase
          .from("decision_outcome_log")
          .select("id", { count: "exact", head: true })
          .eq("execution_status", "not_started"),
        supabase
          .from("decision_outcome_log")
          .select("id", { count: "exact", head: true })
          .eq("execution_status", "overdue"),
        supabase
          .from("decision_outcome_log")
          .select("id", { count: "exact", head: true })
          .eq("execution_status", "in_progress"),
        supabase
          .from("decision_outcome_log")
          .select("id", { count: "exact", head: true })
          .eq("execution_status", "completed")
          .gte("execution_completed_at", since),
        supabase
          .from("decision_outcome_log")
          .select("net_value")
          .eq("outcome_success", true)
          .gte("execution_completed_at", since)
          .limit(500),
      ]);

      const queryErrors = [
        pending.error?.message,
        overdue.error?.message,
        active.error?.message,
        done30.error?.message,
        savings.error?.message,
      ].filter((message): message is string => Boolean(message));

      if (queryErrors.length > 0) {
        throw new Error(queryErrors.join(" · "));
      }

      const recordedNetValue = (savings.data ?? []).reduce(
        (sum, row) => sum + (Number(row.net_value) || 0),
        0,
      );

      return {
        pending: pending.count ?? 0,
        overdue: overdue.count ?? 0,
        active: active.count ?? 0,
        done: done30.count ?? 0,
        recordedNetValue,
      };
    },
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  if (isError) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-start gap-2 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Decision KPIs unavailable
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Query failure is not represented as zero decisions or zero recorded value.
            </p>
            {error instanceof Error && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {error.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Decision KPI data is unavailable.
        </CardContent>
      </Card>
    );
  }

  const formatEuro = (value: number) => {
    if (Math.abs(value) >= 1_000_000) {
      return `€${(value / 1_000_000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `€${Math.round(value / 1_000)}K`;
    }
    return `€${Math.round(value)}`;
  };

  const tiles = [
    {
      icon: Flame,
      value: data.pending,
      label: "Pending action",
      color: data.pending > 0 ? "text-destructive" : "text-foreground",
    },
    {
      icon: AlertTriangle,
      value: data.overdue,
      label: "SLA breached",
      color: data.overdue > 0 ? "text-destructive" : "text-emerald-500",
    },
    {
      icon: PlayCircle,
      value: data.active,
      label: "In progress",
      color: "text-primary",
    },
    {
      icon: CheckCircle2,
      value: data.done,
      label: "Closed (30d)",
      color: "text-emerald-500",
    },
    {
      icon: TrendingUp,
      value: formatEuro(data.recordedNetValue),
      label: "Successful-outcome net value (30d)",
      color:
        data.recordedNetValue > 0
          ? "text-emerald-500"
          : data.recordedNetValue < 0
            ? "text-destructive"
            : "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Card key={tile.label} className="border-border/50">
            <CardContent className="flex items-center gap-3 p-3">
              <Icon className={cn("h-5 w-5 shrink-0", tile.color)} />
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-mono text-xl font-bold leading-none tabular-nums",
                    tile.color,
                  )}
                >
                  {tile.value}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {tile.label}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
