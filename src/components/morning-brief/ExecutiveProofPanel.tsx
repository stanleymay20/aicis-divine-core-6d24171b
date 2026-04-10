import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, DollarSign, CheckCircle2, Target, ArrowRight, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function ExecutiveProofPanel() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["executive-proof"],
    queryFn: async () => {
      const [outcomesRes, winRes] = await Promise.all([
        supabase
          .from("decision_outcome_log")
          .select("id, outcome_success, roi_estimate, net_value, evidence_type, action_taken, execution_status, signal_title, recommended_action, domain, created_at")
          .eq("action_taken", true),
        supabase
          .from("decision_outcome_log")
          .select("signal_title, recommended_action, domain, net_value, roi_estimate, outcome_success, evidence_type")
          .eq("outcome_success", true)
          .not("net_value", "is", null)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      const all = outcomesRes.data || [];
      const completed = all.filter(d => d.outcome_success !== null);
      const totalNetValue = completed.reduce((s, o) => s + (Number(o.net_value) || 0), 0);
      const successRate = completed.length > 0
        ? Math.round((completed.filter(o => o.outcome_success).length / completed.length) * 100)
        : 0;
      const avgROI = completed.length > 0
        ? completed.reduce((s, o) => s + (Number(o.roi_estimate) || 0), 0) / completed.length
        : 0;
      const measured = completed.filter(o => o.evidence_type === "measured").length;

      return {
        acted: all.length,
        completed: completed.length,
        successRate,
        avgROI,
        totalNetValue,
        measured,
        inProgress: all.filter(d => d.execution_status === "in_progress").length,
        lastWin: winRes.data?.[0] || null,
      };
    },
    staleTime: 120_000,
  });

  const fmt = (val: number) => {
    if (val >= 1_000_000) return `€${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `€${(val / 1_000).toFixed(0)}K`;
    return `€${val.toFixed(0)}`;
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (!data || data.acted === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Big value card */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Proven Cost Savings</span>
            {data.measured > 0 && (
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">
                {data.measured} measured
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-bold text-primary">
                {data.totalNetValue > 0 ? fmt(data.totalNetValue) : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Total Value Saved</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {data.avgROI > 0 ? `${data.avgROI.toFixed(1)}x` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Avg ROI</p>
            </div>
            <div>
              <p className={`text-2xl font-bold ${data.successRate >= 70 ? "text-emerald-400" : ""}`}>
                {data.successRate}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Success Rate</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{data.completed}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Actions Tracked</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Last proven win */}
      {data.lastWin && (
        <Card
          className="border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent cursor-pointer hover:border-emerald-500/30 transition-colors"
          onClick={() => navigate("/decision-ops")}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400">Recent Proven Win</span>
            </div>
            <div className="text-sm leading-relaxed space-y-1">
              <p>
                <span className="text-muted-foreground">Detected</span>{" "}
                <span className="font-medium">{data.lastWin.signal_title?.replace("[SIGNAL] ", "")}</span>
              </p>
              {data.lastWin.recommended_action && (
                <p>
                  <span className="text-muted-foreground">→ Action:</span>{" "}
                  <span className="font-medium">{data.lastWin.recommended_action}</span>
                </p>
              )}
              <p>
                <span className="text-muted-foreground">→ Result:</span>{" "}
                <span className="font-medium text-emerald-400">
                  {data.lastWin.net_value ? fmt(Number(data.lastWin.net_value)) + " saved" : "Successful"}
                  {data.lastWin.roi_estimate ? ` (${Number(data.lastWin.roi_estimate).toFixed(1)}x ROI)` : ""}
                </span>
              </p>
            </div>
            <div className="flex items-center justify-end mt-2">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                View all results <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
