import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, AlertTriangle, PlayCircle, CheckCircle2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function DecisionOpsKPIStrip() {
  const { data, isLoading } = useQuery({
    queryKey: ["decision-ops-kpi-strip"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [pending, overdue, active, done30, savings] = await Promise.all([
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "not_started"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "overdue"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "in_progress"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "completed").gte("execution_completed_at", since),
        supabase.from("decision_outcome_log").select("net_value").eq("outcome_success", true).gte("execution_completed_at", since).limit(500),
      ]);
      const saved = (savings.data || []).reduce((s: number, r: any) => s + (Number(r.net_value) || 0), 0);
      const total = (pending.count || 0) + (overdue.count || 0) + (active.count || 0) + (done30.count || 0);
      const rate = total ? Math.round(((done30.count || 0) / total) * 100) : 0;
      return { pending: pending.count || 0, overdue: overdue.count || 0, active: active.count || 0, done: done30.count || 0, saved, rate };
    },
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data) return null;

  const fmtEuro = (v: number) => {
    if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `€${Math.round(v / 1_000)}K`;
    return `€${Math.round(v)}`;
  };

  const tiles = [
    { icon: Flame, value: data.pending, label: "Pending action", color: data.pending > 0 ? "text-destructive" : "text-foreground" },
    { icon: AlertTriangle, value: data.overdue, label: "SLA breached", color: data.overdue > 0 ? "text-destructive" : "text-emerald-500" },
    { icon: PlayCircle, value: data.active, label: "In progress", color: "text-primary" },
    { icon: CheckCircle2, value: data.done, label: "Closed (30d)", color: "text-emerald-500" },
    { icon: TrendingUp, value: fmtEuro(data.saved), label: "Margin protected (30d)", color: data.saved > 0 ? "text-emerald-500" : "text-muted-foreground", isString: true },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Card key={t.label} className="border-border/50">
            <CardContent className="p-3 flex items-center gap-3">
              <Icon className={cn("h-5 w-5 shrink-0", t.color)} />
              <div className="min-w-0">
                <p className={cn("text-xl font-bold font-mono tabular-nums leading-none", t.color)}>{t.value}</p>
                <p className="text-[10px] text-muted-foreground truncate">{t.label}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <div className="col-span-2 sm:col-span-3 lg:col-span-5 flex items-center gap-2 text-[11px] text-muted-foreground font-mono tabular-nums px-1">
        <span>Execution rate (30d):</span>
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-md">
          <div
            className={cn("h-full transition-all duration-700", data.rate >= 50 ? "bg-primary" : data.rate >= 20 ? "bg-amber-500" : "bg-destructive")}
            style={{ width: `${Math.max(data.rate, 2)}%` }}
          />
        </div>
        <span className={cn("font-semibold", data.rate >= 50 ? "text-primary" : "text-destructive")}>{data.rate}%</span>
      </div>
    </div>
  );
}
