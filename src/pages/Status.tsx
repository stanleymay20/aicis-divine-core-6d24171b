import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Activity, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface StatusData {
  overall_status: string;
  components: Array<{ component: string; status: string; response_time_ms: number; last_check: string }>;
  incidents: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    impact: string;
    affected_components: string[];
    started_at: string;
    resolved_at: string | null;
    updates: Array<{ timestamp: string; message: string; status: string }>;
  }>;
  uptime_30d: Array<{ component: string; day: string; uptime_pct: number }>;
  checked_at: string;
}

const statusColors: Record<string, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  partial_outage: "bg-orange-500",
  major_outage: "bg-red-500",
};

const statusLabels: Record<string, string> = {
  operational: "All Systems Operational",
  degraded: "Degraded Performance",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
};

const componentLabels: Record<string, string> = {
  database: "Database",
  storage: "File Storage",
  edge_functions: "Edge Functions",
  api: "API Gateway",
};

export default function Status() {
  const { data, isLoading } = useQuery<StatusData>({
    queryKey: ["public-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_status");
      if (error) throw error;
      return data as unknown as StatusData;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading status…</div>
      </div>
    );
  }

  const overall = data?.overall_status ?? "operational";
  const dotColor = statusColors[overall] ?? "bg-muted";

  // Group uptime by component
  const uptimeByComp: Record<string, Array<{ day: string; uptime_pct: number }>> = {};
  for (const u of data?.uptime_30d ?? []) {
    (uptimeByComp[u.component] ||= []).push(u);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">AICIS System Status</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time operational status of the AICIS intelligence platform
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {/* Overall status banner */}
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className={`h-4 w-4 rounded-full ${dotColor} animate-pulse`} />
              <div className="flex-1">
                <h2 className="text-xl font-semibold">{statusLabels[overall]}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Last checked {data?.checked_at ? formatDistanceToNow(new Date(data.checked_at), { addSuffix: true }) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active incidents */}
        {data?.incidents && data.incidents.filter((i) => !i.resolved_at).length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Active Incidents
            </h3>
            <div className="space-y-3">
              {data.incidents.filter((i) => !i.resolved_at).map((inc) => (
                <Card key={inc.id} className="border-destructive/40">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                          {inc.title}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          Started {formatDistanceToNow(new Date(inc.started_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Badge variant="destructive" className="capitalize">{inc.impact}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {inc.description && <p className="text-sm">{inc.description}</p>}
                    <div className="flex flex-wrap gap-1">
                      {inc.affected_components.map((c) => (
                        <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                      ))}
                    </div>
                    {inc.updates && inc.updates.length > 0 && (
                      <div className="border-l-2 border-border pl-3 mt-3 space-y-2">
                        {inc.updates.slice(-3).reverse().map((u, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="font-medium capitalize">{u.status}:</span> {u.message}
                            <div className="text-muted-foreground text-[10px]">
                              {formatDistanceToNow(new Date(u.timestamp), { addSuffix: true })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Components */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Components
          </h3>
          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {data?.components && data.components.length > 0 ? (
                data.components.map((c) => (
                  <div key={c.component} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      {c.status === "healthy" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : c.status === "degraded" ? (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )}
                      <div>
                        <div className="font-medium text-sm">
                          {componentLabels[c.component] ?? c.component}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.response_time_ms ? `${c.response_time_ms}ms` : "—"}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant={c.status === "healthy" ? "secondary" : "destructive"}
                      className="capitalize"
                    >
                      {c.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No recent health data
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* 30-day uptime */}
        {Object.keys(uptimeByComp).length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              30-Day Uptime
            </h3>
            <div className="space-y-3">
              {Object.entries(uptimeByComp).map(([comp, days]) => {
                const avg = days.reduce((s, d) => s + Number(d.uptime_pct), 0) / days.length;
                return (
                  <Card key={comp}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">
                          {componentLabels[comp] ?? comp}
                        </span>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {avg.toFixed(2)}% uptime
                        </span>
                      </div>
                      <div className="flex gap-[2px] h-8">
                        {Array.from({ length: 30 }).map((_, i) => {
                          const day = days[i];
                          const pct = day ? Number(day.uptime_pct) : null;
                          const color =
                            pct === null ? "bg-muted" :
                            pct >= 99 ? "bg-emerald-500" :
                            pct >= 95 ? "bg-amber-500" : "bg-destructive";
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-sm ${color} opacity-80 hover:opacity-100 transition-opacity`}
                              title={day ? `${day.day}: ${pct}%` : "no data"}
                            />
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Recent resolved incidents */}
        {data?.incidents && data.incidents.filter((i) => i.resolved_at).length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Recently Resolved
            </h3>
            <div className="space-y-2">
              {data.incidents.filter((i) => i.resolved_at).slice(0, 5).map((inc) => (
                <Card key={inc.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm">{inc.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Resolved {formatDistanceToNow(new Date(inc.resolved_at!), { addSuffix: true })}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-muted-foreground pt-8 border-t">
          <div className="flex items-center justify-center gap-2">
            <Activity className="h-3 w-3" />
            <span>Status auto-refreshes every 30 seconds</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
