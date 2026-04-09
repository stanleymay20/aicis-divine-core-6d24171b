import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, DollarSign, CheckCircle2, Target, Loader2 } from "lucide-react";

export const ProofOfValueWidget = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["proof-of-value-summary"],
    queryFn: async () => {
      const [decisionsRes, outcomesRes, measuredRes] = await Promise.all([
        supabase
          .from("decision_outcome_log")
          .select("id, action_taken, outcome_success, evidence_type, roi_value, cost_saved, execution_status")
          .eq("action_taken", true),
        supabase
          .from("decision_outcome_log")
          .select("id, outcome_success, roi_value, cost_saved, evidence_type")
          .not("outcome_success", "is", null),
        supabase
          .from("decision_outcome_log")
          .select("id, roi_value, cost_saved")
          .eq("evidence_type", "measured"),
      ]);

      const decisions = decisionsRes.data || [];
      const outcomes = outcomesRes.data || [];
      const measured = measuredRes.data || [];

      const totalROI = outcomes.reduce((sum, o) => sum + (Number(o.roi_value) || 0), 0);
      const totalSaved = outcomes.reduce((sum, o) => sum + (Number(o.cost_saved) || 0), 0);
      const successRate = outcomes.length > 0
        ? Math.round((outcomes.filter(o => o.outcome_success).length / outcomes.length) * 100)
        : 0;

      return {
        actedDecisions: decisions.length,
        completedOutcomes: outcomes.length,
        successRate,
        measuredCount: measured.length,
        totalROI,
        totalSaved,
        inProgress: decisions.filter(d => d.execution_status === "in_progress").length,
      };
    },
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-4 flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.actedDecisions === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            System Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No decisions acted on yet. Use "Ask AI" to create your first signal-driven decision.
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          Proven System Value
          {data.measuredCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">
              {data.measuredCount} measured
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ValueStat
            icon={<Target className="h-3.5 w-3.5 text-primary" />}
            label="Decisions Acted"
            value={String(data.actedDecisions)}
            sub={`${data.inProgress} in progress`}
          />
          <ValueStat
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
            label="Outcomes"
            value={String(data.completedOutcomes)}
            sub={`${data.successRate}% success`}
          />
          <ValueStat
            icon={<DollarSign className="h-3.5 w-3.5 text-amber-500" />}
            label="Value Saved"
            value={data.totalSaved > 0 ? formatCurrency(data.totalSaved) : "—"}
            sub={data.totalSaved > 0 ? "cost avoided" : "Not yet recorded"}
          />
          <ValueStat
            icon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />}
            label="ROI Generated"
            value={data.totalROI > 0 ? `${data.totalROI.toFixed(1)}x` : "—"}
            sub={data.totalROI > 0 ? "avg return" : "Not yet recorded"}
          />
        </div>
      </CardContent>
    </Card>
  );
};

const ValueStat = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) => (
  <div className="space-y-1">
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {icon}
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
    </div>
    <p className="text-lg font-semibold">{value}</p>
    <p className="text-[10px] text-muted-foreground">{sub}</p>
  </div>
);
