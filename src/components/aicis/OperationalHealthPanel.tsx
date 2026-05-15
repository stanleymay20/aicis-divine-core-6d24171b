import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, DatabaseZap, ShieldCheck } from "lucide-react";

const tone = (state?: string | null) => {
  if (state === "healthy") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  if (state === "stale") return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return "bg-rose-500/10 text-rose-300 border-rose-500/30";
};

export function OperationalHealthPanel() {
  const sourceHealth = useQuery({
    queryKey: ["operational-source-health"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_source_health_view" as any)
        .select("*")
        .limit(8);

      if (error) throw error;
      return data ?? [];
    },
  });

  const incidents = useQuery({
    queryKey: ["operational-incidents"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_incident_command_view" as any)
        .select("*")
        .limit(6);

      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card className="border-border bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-primary" />
            Source Health
          </CardTitle>
          <CardDescription>
            Institutional feed freshness and ingestion reliability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sourceHealth.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <ScrollArea className="h-[260px] pr-2">
              <div className="space-y-2">
                {(sourceHealth.data ?? []).map((source: any, idx: number) => (
                  <div key={`${source.provider_key}-${idx}`} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{source.provider_name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {source.records_ingested ?? 0} records · {source.freshness_minutes ?? 0} min ago
                        </div>
                      </div>
                      <Badge variant="outline" className={tone(source.freshness_state)}>
                        {source.freshness_state ?? "unknown"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            Incident Coordination
          </CardTitle>
          <CardDescription>
            Live escalation and intervention lifecycle visibility.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {incidents.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <ScrollArea className="h-[260px] pr-2">
              <div className="space-y-2">
                {(incidents.data ?? []).map((incident: any, idx: number) => (
                  <div key={`${incident.incident_title}-${idx}`} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium leading-snug">
                          {incident.incident_title}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Stage: {incident.lifecycle_stage ?? "detected"}
                        </div>
                        {incident.recommended_action && (
                          <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
                            {incident.recommended_action}
                          </div>
                        )}
                      </div>

                      <Badge variant="outline" className={tone(incident.severity === "critical" ? "degraded" : incident.severity === "strategic" ? "stale" : "healthy")}>
                        {incident.severity ?? "strategic"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
