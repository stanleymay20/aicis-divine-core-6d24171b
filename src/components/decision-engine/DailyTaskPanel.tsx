import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, Zap, AlertTriangle, Clock, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function DailyTaskPanel() {
  const [running, setRunning] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ["daily-task-stats"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const now = new Date().toISOString();

      const [todayRecs, pendingExec, missingOutcome, overdueReviews] = await Promise.all([
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).gte("created_at", today),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true })
          .eq("recommendation_accepted", true).or("execution_status.is.null,execution_status.eq.not_started"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true })
          .eq("execution_status", "completed").is("outcome_success", null),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true })
          .or("review_status.is.null,review_status.eq.pending").lt("review_due_at", now).not("review_due_at", "is", null),
      ]);

      return {
        todayRecs: todayRecs.count ?? 0,
        pendingExec: pendingExec.count ?? 0,
        missingOutcome: missingOutcome.count ?? 0,
        overdueReviews: overdueReviews.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  const { currentLevel } = useMfaAssurance();
  const needsMfa = currentLevel !== "aal2";
  const triggerDailyInference = async () => {
    if (needsMfa) { toast.error("This action needs two-step sign-in (MFA). It still runs automatically on schedule."); return; }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("trigger-daily-inference");
      if (error) throw error;
      toast.success(`Generated ${data?.total_recommendations || 0} recommendations across ${7 - (data?.failed_domains || 0)} domains`);
    } catch (e: any) {
      toast.error(e.message || "Failed to trigger daily inference");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-primary" /> Daily Operations
          </CardTitle>
          <Button size="sm" variant="default" className="h-7 text-xs" onClick={triggerDailyInference} disabled={running} title={needsMfa ? "Requires two-step sign-in (MFA)" : undefined}>
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
            {running ? "Running..." : "Generate Recommendations"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox icon={<Zap className="h-3.5 w-3.5" />} label="Today's Recs" value={stats?.todayRecs ?? 0} />
          <StatBox
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Pending Execution"
            value={stats?.pendingExec ?? 0}
            warn={(stats?.pendingExec ?? 0) > 0}
          />
          <StatBox
            icon={<CheckCircle className="h-3.5 w-3.5" />}
            label="Missing Outcomes"
            value={stats?.missingOutcome ?? 0}
            warn={(stats?.missingOutcome ?? 0) > 0}
          />
          <StatBox
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Overdue Reviews"
            value={stats?.overdueReviews ?? 0}
            destructive={(stats?.overdueReviews ?? 0) > 0}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({ icon, label, value, warn, destructive }: {
  icon: React.ReactNode; label: string; value: number;
  warn?: boolean; destructive?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border ${destructive ? "border-destructive/30 bg-destructive/5" : warn ? "border-warning/30 bg-warning/5" : "border-border bg-muted/20"}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={destructive ? "text-destructive" : warn ? "text-warning" : "text-muted-foreground"}>{icon}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className={`text-lg font-bold ${destructive ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
