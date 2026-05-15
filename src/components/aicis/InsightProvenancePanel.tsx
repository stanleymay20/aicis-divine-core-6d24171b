import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit, Clock3, ShieldCheck } from "lucide-react";

const confidenceTone = (score?: number | null) => {
  const value = Number(score ?? 0);
  if (value >= 80) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  if (value >= 60) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return "bg-rose-500/10 text-rose-300 border-rose-500/30";
};

export function InsightProvenancePanel() {
  const insights = useQuery({
    queryKey: ["insight-provenance"],
    refetchInterval: 45000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("executive_planetary_insights_view" as any)
        .select("*")
        .limit(6);

      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Evidence & Provenance
        </CardTitle>
        <CardDescription>
          Confidence, freshness, and operational traceability for generated intelligence.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {insights.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <ScrollArea className="h-[260px] pr-2">
            <div className="space-y-2">
              {(insights.data ?? []).map((insight: any, idx: number) => (
                <div
                  key={`${insight.insight_title}-${idx}`}
                  className="rounded-lg border border-border bg-background/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <BrainCircuit className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="text-sm font-medium truncate">
                          {insight.insight_title ?? "Operational insight"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-2">
                        <div className="flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {insight.generated_at
                            ? new Date(insight.generated_at).toLocaleString()
                            : "unknown time"}
                        </div>

                        <span>•</span>

                        <span>
                          Severity: {insight.severity_band ?? "strategic"}
                        </span>
                      </div>

                      {insight.recommended_action && (
                        <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs line-clamp-2">
                          {insight.recommended_action}
                        </div>
                      )}
                    </div>

                    <Badge
                      variant="outline"
                      className={confidenceTone(insight.confidence_score)}
                    >
                      {Math.round(Number(insight.confidence_score ?? 0))}%
                    </Badge>
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
