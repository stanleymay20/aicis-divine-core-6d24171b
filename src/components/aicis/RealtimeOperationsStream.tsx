import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, BrainCircuit, RadioTower, ShieldCheck, Zap } from "lucide-react";

type StreamEvent = {
  id: string;
  title: string;
  domain: string;
  severity: string;
  summary: string;
  timestamp: string;
  source: string;
};

const severityTone = (severity?: string) => {
  switch (severity) {
    case "critical":
      return "bg-rose-500/10 text-rose-300 border-rose-500/30";
    case "strategic":
    case "high":
      return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    case "healthy":
    case "resolved":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    default:
      return "bg-primary/10 text-primary border-primary/30";
  }
};

const eventIcon = (domain?: string) => {
  if (!domain) return Activity;
  if (domain.includes("cyber") || domain.includes("security")) return ShieldCheck;
  if (domain.includes("climate") || domain.includes("risk")) return AlertTriangle;
  if (domain.includes("agent") || domain.includes("ai")) return BrainCircuit;
  return RadioTower;
};

export function RealtimeOperationsStream() {
  const [livePulse, setLivePulse] = useState(false);

  const telemetry = useQuery({
    queryKey: ["realtime-telemetry-stream"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telemetry_backbone_command_view" as any)
        .select("*")
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const causal = useQuery({
    queryKey: ["realtime-causal-stream"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planetary_causal_command_view" as any)
        .select("*")
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const interventions = useQuery({
    queryKey: ["realtime-intervention-stream"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intervention_governance_command_view" as any)
        .select("*")
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setLivePulse((v) => !v);
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  const stream = useMemo(() => {
    const telemetryEvents: StreamEvent[] = (telemetry.data ?? []).map((row: any, index: number) => ({
      id: `telemetry-${index}`,
      title: `${row.source_domain ?? "domain"} telemetry update`,
      domain: row.source_domain ?? "telemetry",
      severity: row.event_status === "failed" ? "critical" : row.event_status === "queued" ? "strategic" : "healthy",
      summary: `${row.event_count ?? 0} events processed across shard ${row.shard_key ?? 0}`,
      timestamp: row.generated_at ?? new Date().toISOString(),
      source: "Telemetry Backbone",
    }));

    const causalEvents: StreamEvent[] = (causal.data ?? []).map((row: any, index: number) => ({
      id: `causal-${index}`,
      title: row.source_event ?? "Propagation event",
      domain: row.source_domain ?? "causal",
      severity: Number(row.impact_severity ?? 0) >= 75 ? "critical" : "strategic",
      summary: `${row.source_domain ?? "domain"} propagating toward ${row.impacted_system ?? "system"}`,
      timestamp: row.generated_at ?? new Date().toISOString(),
      source: "Causal Engine",
    }));

    const interventionEvents: StreamEvent[] = (interventions.data ?? []).map((row: any, index: number) => ({
      id: `intervention-${index}`,
      title: row.simulation_name ?? "Intervention workflow",
      domain: "governance",
      severity: row.approval_status === "rejected" ? "critical" : row.approval_status === "approved" ? "healthy" : "strategic",
      summary: `Safety ${row.safety_rating ?? "unknown"} · confidence ${row.confidence_score ?? 0}`,
      timestamp: row.generated_at ?? new Date().toISOString(),
      source: "Governance Layer",
    }));

    return [...telemetryEvents, ...causalEvents, ...interventionEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 18);
  }, [telemetry.data, causal.data, interventions.data]);

  const loading = telemetry.isLoading || causal.isLoading || interventions.isLoading;

  return (
    <Card className="border-border bg-card/70 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Realtime Operations Stream
            </CardTitle>
            <CardDescription>
              Live operational telemetry, propagation activity, and governance events.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${livePulse ? "bg-emerald-400 shadow-[0_0_14px_rgba(74,222,128,0.9)]" : "bg-emerald-700"}`} />
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
              Live
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : stream.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-sm text-muted-foreground">
            No realtime operational activity yet. Populate telemetry and governance command views.
          </div>
        ) : (
          <ScrollArea className="h-[340px] pr-2">
            <div className="space-y-2">
              {stream.map((event, index) => {
                const Icon = eventIcon(event.domain);
                return (
                  <div key={event.id} className="relative overflow-hidden rounded-xl border border-border bg-background/40 p-3">
                    <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary/40" />
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg border border-border bg-card p-2">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium line-clamp-1">{event.title}</p>
                              <Badge variant="outline" className={severityTone(event.severity)}>
                                {event.severity}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {event.summary}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {event.source}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>

                        {index < 4 && (
                          <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-primary">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                            Active operational propagation
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
