import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

const tone = (value?: number | null) => {
  const score = Number(value ?? 0);
  if (score >= 0.85) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  if (score >= 0.65) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return "bg-rose-500/10 text-rose-300 border-rose-500/30";
};

export function ValidationTrustCenter() {
  const validation = useQuery({
    queryKey: ["validation-trust-command"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_trust_command_view" as any)
        .select("*")
        .limit(20);

      if (error) throw error;
      return data ?? [];
    },
  });

  const scorecard = useQuery({
    queryKey: ["validation-scorecard"],
    refetchInterval: 45000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_trust_scorecard_view" as any)
        .select("*")
        .limit(10);

      if (error) throw error;
      return data ?? [];
    },
  });

  const averageTrust = (() => {
    const rows = validation.data ?? [];
    if (!rows.length) return 0;

    const total = rows.reduce(
      (sum: number, row: any) => sum + Number(row.operational_trust_score ?? 0),
      0
    );

    return total / rows.length;
  })();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border bg-card/70">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <Badge variant="outline" className={tone(averageTrust)}>
                {Math.round(averageTrust * 100)}%
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">Operational Trust</div>
            <div className="text-2xl font-semibold mt-1">Global Score</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/70">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="h-5 w-5 text-primary" />
              <Badge variant="outline">Live</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Forecast Validation</div>
            <div className="text-2xl font-semibold mt-1">
              {scorecard.data?.length ?? 0} Cycles
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/70">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <BrainCircuit className="h-5 w-5 text-primary" />
              <Badge variant="outline">Adaptive</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Calibration Engine</div>
            <div className="text-2xl font-semibold mt-1">Active</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/70">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Activity className="h-5 w-5 text-primary" />
              <Badge variant="outline">Realtime</Badge>
            </div>
            <div className="text-sm text-muted-foreground">Validation Status</div>
            <div className="text-2xl font-semibold mt-1">Operational</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card/70">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Validation Cycles
            </CardTitle>
            <CardDescription>
              Forecast, calibration, and trust recomputation activity.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {scorecard.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <ScrollArea className="h-[340px] pr-2">
                <div className="space-y-2">
                  {(scorecard.data ?? []).map((row: any, idx: number) => (
                    <div
                      key={`${row.validation_type}-${idx}`}
                      className="rounded-xl border border-border bg-background/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">
                            {row.validation_type ?? "validation_cycle"}
                          </div>

                          <div className="text-xs text-muted-foreground mt-2">
                            Accuracy: {Math.round(Number(row.accuracy_score ?? 0) * 100)}%
                            {' · '}
                            Precision: {Math.round(Number(row.precision_score ?? 0) * 100)}%
                          </div>
                        </div>

                        <Badge
                          variant="outline"
                          className={tone(row.overall_validation_signal)}
                        >
                          {Math.round(Number(row.overall_validation_signal ?? 0) * 100)}%
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
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Drift & Corroboration
            </CardTitle>
            <CardDescription>
              Source degradation, corroboration confidence, and operational drift.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {validation.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <ScrollArea className="h-[340px] pr-2">
                <div className="space-y-2">
                  {(validation.data ?? []).map((row: any, idx: number) => (
                    <div
                      key={`${row.provider_name}-${idx}`}
                      className="rounded-xl border border-border bg-background/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">
                            {row.provider_name ?? row.validation_type ?? "Operational provider"}
                          </div>

                          <div className="flex items-center gap-2 flex-wrap mt-2 text-xs text-muted-foreground">
                            <span>
                              Corroboration {Math.round(Number(row.corroboration_score ?? 0) * 100)}%
                            </span>
                            <span>•</span>
                            <span>
                              Confidence {Math.round(Number(row.operational_confidence ?? 0) * 100)}%
                            </span>
                          </div>

                          {row.recommended_action && (
                            <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
                              {row.recommended_action}
                            </div>
                          )}
                        </div>

                        <Badge
                          variant="outline"
                          className={tone(row.operational_trust_score)}
                        >
                          {row.drift_detected ? row.drift_severity : 'stable'}
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
    </div>
  );
}
