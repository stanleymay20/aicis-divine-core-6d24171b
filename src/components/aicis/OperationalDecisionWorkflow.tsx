import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, CheckCircle2, ClipboardCheck, Radar, ShieldAlert, Sparkles } from "lucide-react";

type WorkflowEvent = {
  title: string;
  severity: string;
  confidence?: number;
  recommendation?: string;
  source?: string;
  status?: string;
};

const severityTone = (severity?: string | null) => {
  if (severity === "critical" || severity === "high") return "bg-rose-500/10 text-rose-300 border-rose-500/30";
  if (severity === "strategic" || severity === "medium") return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
};

export function OperationalDecisionWorkflow() {
  const insights = useQuery({
    queryKey: ["operational-workflow-insights"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("executive_planetary_insights_view" as any)
        .select("*")
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const interventions = useQuery({
    queryKey: ["operational-workflow-interventions"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intervention_governance_command_view" as any)
        .select("*")
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const flow = useMemo(() => {
    const insight: any = insights.data?.[0];
    const intervention: any = interventions.data?.[0];

    const stages: WorkflowEvent[] = [
      {
        title: insight?.insight_title ?? "Signal detected",
        severity: insight?.severity_band ?? "strategic",
        confidence: insight?.confidence_score ?? 82,
        source: "Detection",
      },
      {
        title: "Propagation forecast generated",
        severity: "strategic",
        confidence: 79,
        source: "Forecast Engine",
      },
      {
        title: intervention?.simulation_name ?? "Intervention review",
        severity: intervention?.approval_status ?? "pending",
        recommendation: intervention?.safety_rating ?? "review required",
        source: "Governance",
      },
      {
        title: "Operator action coordination",
        severity: "healthy",
        recommendation: insight?.recommended_action ?? "Continue monitoring",
        source: "Execution",
      },
    ];

    return stages;
  }, [insights.data, interventions.data]);

  const loading = insights.isLoading || interventions.isLoading;

  return (
    <Card className="border-border bg-card/70 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              Operational Decision Workflow
            </CardTitle>
            <CardDescription>
              Concise incident-to-decision operational coordination flow.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm">Review</Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {flow.map((stage, index) => {
              const Icon = index === 0 ? Radar : index === 1 ? Sparkles : index === 2 ? ShieldAlert : CheckCircle2;
              return (
                <div key={stage.title} className="relative rounded-xl border border-border bg-background/40 p-4 min-h-[170px]">
                  {index < flow.length - 1 && (
                    <ArrowRight className="hidden lg:block absolute -right-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  )}

                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="rounded-lg border border-border bg-card p-2">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <Badge variant="outline" className={severityTone(stage.severity)}>
                      {stage.severity}
                    </Badge>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      {stage.source}
                    </div>
                    <h3 className="text-sm font-medium leading-snug">
                      {stage.title}
                    </h3>
                  </div>

                  {stage.confidence !== undefined && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Confidence {Math.round(stage.confidence)}%
                    </div>
                  )}

                  {stage.recommendation && (
                    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs">
                      {stage.recommendation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
