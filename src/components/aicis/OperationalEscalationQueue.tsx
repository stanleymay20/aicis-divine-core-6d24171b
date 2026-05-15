import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react";

const severityTone = (severity?: string | null) => {
  if (severity === "critical") return "bg-rose-500/10 text-rose-300 border-rose-500/30";
  if (severity === "strategic") return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
};

export function OperationalEscalationQueue() {
  const escalationQueue = useQuery({
    queryKey: ["operational-escalation-queue"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_incident_command_view" as any)
        .select("*")
        .limit(10);

      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Escalation Queue
            </CardTitle>
            <CardDescription>
              Prioritized operational incidents requiring coordination.
            </CardDescription>
          </div>

          <Badge variant="outline" className="uppercase tracking-wider text-[10px]">
            Live Queue
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {escalationQueue.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <ScrollArea className="h-[320px] pr-2">
            <div className="space-y-2">
              {(escalationQueue.data ?? []).map((incident: any, idx: number) => (
                <div
                  key={`${incident.incident_title}-${idx}`}
                  className="rounded-xl border border-border bg-background/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-medium leading-snug">
                          {incident.incident_title ?? "Operational incident"}
                        </div>

                        <Badge
                          variant="outline"
                          className={severityTone(incident.severity)}
                        >
                          {incident.severity ?? "strategic"}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-2">
                        <div className="flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {incident.lifecycle_stage ?? "detected"}
                        </div>

                        <span>•</span>

                        <span>
                          Escalation {Math.round(Number(incident.escalation_score ?? 0))}
                        </span>
                      </div>

                      {incident.recommended_action && (
                        <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs leading-relaxed">
                          {incident.recommended_action}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-8 text-xs">
                        <ArrowUpRight className="h-3 w-3 mr-1" />
                        Review
                      </Button>

                      <Button size="sm" className="h-8 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Acknowledge
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
