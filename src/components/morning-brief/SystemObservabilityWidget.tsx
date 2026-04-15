import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, AlertCircle, CheckCircle2, Clock } from "lucide-react";

export function SystemObservabilityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["system-observability"],
    queryFn: async () => {
      const now = new Date();
      const sixHoursAgo = new Date(now.getTime() - 6 * 3600_000).toISOString();
      const oneDayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();

      const [cronErrors, zombies, recentSuccess, executionStats] = await Promise.all([
        supabase
          .from("automation_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "error")
          .gte("executed_at", sixHoursAgo),
        supabase
          .from("automation_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "running")
          .lt("executed_at", new Date(now.getTime() - 3600_000).toISOString()),
        supabase
          .from("automation_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "success")
          .gte("executed_at", oneDayAgo),
        supabase
          .from("decision_outcome_log")
          .select("execution_status"),
      ]);

      const execData = executionStats.data || [];
      const total = execData.length;
      const completed = execData.filter(e => e.execution_status === "completed").length;
      const overdue = execData.filter(e => e.execution_status === "overdue").length;
      const executionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      const cronHealth = (cronErrors.count || 0) < 5 && (zombies.count || 0) === 0;

      return {
        cronErrors: cronErrors.count || 0,
        zombieJobs: zombies.count || 0,
        successfulJobs24h: recentSuccess.count || 0,
        executionRate,
        overdue,
        cronHealth,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading || !data) return null;

  return (
    <Card className="border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">System Health</span>
          <Badge
            variant={data.cronHealth ? "default" : "destructive"}
            className="text-[10px] h-4 ml-auto"
          >
            {data.cronHealth ? "Healthy" : "Issues Detected"}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            {data.cronErrors === 0 ? (
              <CheckCircle2 className="h-3 w-3 text-primary" />
            ) : (
              <AlertCircle className="h-3 w-3 text-destructive" />
            )}
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{data.cronErrors}</span> cron errors (6h)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {data.zombieJobs === 0 ? (
              <CheckCircle2 className="h-3 w-3 text-primary" />
            ) : (
              <AlertCircle className="h-3 w-3 text-accent-foreground" />
            )}
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{data.zombieJobs}</span> zombie jobs
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{data.successfulJobs24h}</span> jobs OK (24h)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className={data.executionRate >= 50 ? "text-primary font-medium" : "text-destructive font-medium"}>
              {data.executionRate}% exec rate
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}