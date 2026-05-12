import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, GitBranch, ListChecks, Network, Radio, Workflow } from "lucide-react";

type EventBusRow = {
  event_type: string;
  priority: string;
  status: string;
  rows: number;
  oldest_created_at: string | null;
  latest_updated_at: string | null;
  dead_letters: number;
};

type TraceRow = {
  operation_name: string;
  provider: string | null;
  layer: string | null;
  spans: number;
  success_spans: number;
  problem_spans: number;
  avg_duration_ms: number | null;
  latest_started_at: string | null;
};

type TaskRow = {
  id: string;
  task_type: string;
  priority: string;
  status: string;
  title: string;
  description: string | null;
  related_resource_type: string | null;
  created_at: string;
};

type AnomalyRow = {
  id: string;
  anomaly_type: string;
  severity: string;
  layer: string | null;
  metric_name: string | null;
  observed_value: number | null;
  expected_value: number | null;
  description: string;
  created_at: string;
};

const priorityTone: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  normal: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

export default function OperationsBackplane() {
  const eventBus = useQuery({
    queryKey: ["operations-event-bus"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_event_bus_operations" as any).select("*").limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as EventBusRow[];
    },
  });

  const traces = useQuery({
    queryKey: ["operations-traces"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_pipeline_trace_summary" as any).select("*").limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as TraceRow[];
    },
  });

  const tasks = useQuery({
    queryKey: ["operations-review-console"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_analyst_review_console" as any).select("*").limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as TaskRow[];
    },
  });

  const anomalies = useQuery({
    queryKey: ["operations-open-anomalies"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_open_observability_anomalies" as any).select("*").limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as AnomalyRow[];
    },
  });

  const totalQueued = (eventBus.data ?? []).filter((r) => r.status === "queued").reduce((a, r) => a + Number(r.rows ?? 0), 0);
  const deadLetters = (eventBus.data ?? []).reduce((a, r) => a + Number(r.dead_letters ?? 0), 0);
  const problemSpans = (traces.data ?? []).reduce((a, r) => a + Number(r.problem_spans ?? 0), 0);
  const openTasks = tasks.data?.length ?? 0;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Workflow className="h-5 w-5 text-primary" /> Operations Backplane
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Operator view for event bus queues, distributed traces, open anomalies, and analyst review work. This keeps backend machinery visible only to operators/admins.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard icon={<Radio className="h-4 w-4" />} label="Queued Events" value={totalQueued.toLocaleString()} />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="Dead Letters" value={deadLetters.toLocaleString()} />
          <MetricCard icon={<GitBranch className="h-4 w-4" />} label="Problem Spans" value={problemSpans.toLocaleString()} />
          <MetricCard icon={<ListChecks className="h-4 w-4" />} label="Open Tasks" value={openTasks.toLocaleString()} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Radio className="h-4 w-4 text-primary" /> Event Bus</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {eventBus.isLoading ? <Skeleton className="h-32 w-full" /> : (eventBus.data ?? []).slice(0, 12).map((r) => (
                <div key={`${r.event_type}-${r.priority}-${r.status}`} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.event_type}</p>
                    <p className="text-xs text-muted-foreground">{r.status} · {Number(r.rows).toLocaleString()} rows</p>
                  </div>
                  <Badge variant="outline" className={priorityTone[r.priority] ?? priorityTone.low}>{r.priority}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary" /> Pipeline Traces</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {traces.isLoading ? <Skeleton className="h-32 w-full" /> : (traces.data ?? []).slice(0, 12).map((r) => (
                <div key={`${r.operation_name}-${r.provider}-${r.layer}`} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.operation_name}</p>
                    <p className="text-xs text-muted-foreground">{r.provider ?? "system"} · {r.layer ?? "layer"} · avg {Math.round(Number(r.avg_duration_ms ?? 0)).toLocaleString()}ms</p>
                  </div>
                  <Badge variant="outline" className={Number(r.problem_spans) > 0 ? priorityTone.high : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"}>{Number(r.problem_spans)} issues</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Open Anomalies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {anomalies.isLoading ? <Skeleton className="h-32 w-full" /> : (anomalies.data ?? []).slice(0, 10).map((a) => (
                <div key={a.id} className="border border-border rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{a.metric_name ?? a.anomaly_type}</p>
                    <Badge variant="outline" className={priorityTone[a.severity] ?? priorityTone.low}>{a.severity}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Network className="h-4 w-4 text-primary" /> Analyst Review Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.isLoading ? <Skeleton className="h-32 w-full" /> : (tasks.data ?? []).slice(0, 10).map((t) => (
                <div key={t.id} className="border border-border rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium line-clamp-1">{t.title}</p>
                    <Badge variant="outline" className={priorityTone[t.priority] ?? priorityTone.low}>{t.priority}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.task_type} · {t.status}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AICISLayout>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
        <p className="text-2xl font-semibold mt-2">{value}</p>
      </CardContent>
    </Card>
  );
}
