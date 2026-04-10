import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, ArrowRight, TrendingUp, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface RecentDecision {
  id: string;
  signal_title: string;
  domain: string;
  action_taken: boolean;
  outcome_success: boolean | null;
  execution_status: string | null;
  impact_score: number | null;
  evidence_type: string | null;
  created_at: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  health: "Workforce risk", security: "Security", economy: "Cost exposure",
  energy: "Fuel / transport", food: "Input pricing", governance: "Compliance",
  geopolitical: "Trade route", climate_disaster: "Shipping risk",
  supply_chain: "Supply continuity", infrastructure: "Logistics",
};

export const RecentDecisionsWidget = () => {
  const navigate = useNavigate();

  const { data: decisions = [] } = useQuery<RecentDecision[]>({
    queryKey: ["morning-brief-decisions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decision_outcome_log")
        .select("id, signal_title, domain, action_taken, outcome_success, execution_status, impact_score, evidence_type, created_at")
        .eq("action_taken", true)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data as any[]) || [];
    },
    staleTime: 60_000,
  });

  if (decisions.length === 0) return null;

  const completedCount = decisions.filter(d => d.outcome_success !== null).length;
  const successCount = decisions.filter(d => d.outcome_success === true).length;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Recent Actions</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-primary gap-1 h-7"
            onClick={() => navigate("/decision-ops")}
          >
            View all <ArrowRight className="h-3 w-3" />
          </Button>
        </div>

        {completedCount > 0 && (
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] h-5 gap-1">
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
              {successCount}/{completedCount} successful
            </Badge>
            {decisions.some(d => d.evidence_type === "measured") && (
              <Badge variant="outline" className="text-[10px] h-5 gap-1 border-primary/30 text-primary">
                Measured evidence
              </Badge>
            )}
          </div>
        )}

        <div className="space-y-2">
          {decisions.map((d) => (
            <div
              key={d.id}
              className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => navigate("/decision-ops")}
            >
              <div className="mt-0.5 shrink-0">
                {d.outcome_success === true && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                {d.outcome_success === false && <XCircle className="h-3.5 w-3.5 text-red-400" />}
                {d.outcome_success === null && <Clock className="h-3.5 w-3.5 text-yellow-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-snug line-clamp-1">
                  {d.signal_title?.replace("[SIGNAL] ", "")}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="secondary" className="text-[9px] h-4 px-1.5 gap-0.5">
                    <Package className="h-2 w-2" />
                    {DOMAIN_LABELS[d.domain] || d.domain}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {d.execution_status === "completed" ? "Completed" :
                     d.execution_status === "in_progress" ? "In progress" : "Pending"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
