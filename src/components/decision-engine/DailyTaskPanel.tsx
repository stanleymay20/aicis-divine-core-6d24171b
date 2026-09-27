import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { describeFunctionError } from "@/lib/supabase-errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle,
  Clock,
  Loader2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export default function DailyTaskPanel() {
  const [running, setRunning] = useState(false);

  const {
    data: stats,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["daily-task-stats"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const now = new Date().toISOString();

      const [todayRecs, pendingExec, missingOutcome, overdueReviews] =
        await Promise.all([
          supabase
            .from("decision_outcome_log")
            .select("id", { count: "exact", head: true })
            .gte("created_at", today),
          supabase
            .from("decision_outcome_log")
            .select("id", { count: "exact", head: true })
            .eq("recommendation_accepted", true)
            .or("execution_status.is.null,execution_status.eq.not_started"),
          supabase
            .from("decision_outcome_log")
            .select("id", { count: "exact", head: true })
            .eq("execution_status", "completed")
            .is("outcome_success", null),
          supabase
            .from("decision_outcome_log")
            .select("id", { count: "exact", head: true })
            .or("review_status.is.null,review_status.eq.pending")
            .lt("review_due_at", now)
            .not("review_due_at", "is", null),
        ]);

      const queryErrors = [
        todayRecs.error?.message,
        pendingExec.error?.message,
        missingOutcome.error?.message,
        overdueReviews.error?.message,
      ].filter((message): message is string => Boolean(message));

      if (queryErrors.length > 0) {
        throw new Error(queryErrors.join(" · "));
      }

      return {
        todayRecs: todayRecs.count ?? 0,
        pendingExec: pendingExec.count ?? 0,
        missingOutcome: missingOutcome.count ?? 0,
        overdueReviews: overdueReviews.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  const triggerDailyInference = async () => {
    setRunning(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "trigger-daily-inference",
      );
      if (invokeError) {
        toast.error(
          await describeFunctionError(
            invokeError,
            "Failed to trigger daily inference",
          ),
        );
        return;
      }

      const total =
        typeof data?.total_recommendations === "number"
          ? data.total_recommendations
          : null;
      const failedDomains =
        typeof data?.failed_domains === "number" ? data.failed_domains : null;

      toast.success(
        total == null
          ? "Recommendation generation completed."
          : `Generated ${total} recommendation${total === 1 ? "" : "s"}${failedDomains && failedDomains > 0 ? ` · ${failedDomains} domain${failedDomains === 1 ? "" : "s"} failed` : ""}`,
      );
    } catch (invokeError: unknown) {
      toast.error(
        invokeError instanceof Error
          ? invokeError.message
          : "Failed to trigger daily inference",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <CalendarClock className="h-3.5 w-3.5 text-primary" />
            Daily Operations
          </CardTitle>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={triggerDailyInference}
            disabled={running}
          >
            {running ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Zap className="mr-1 h-3 w-3" />
            )}
            {running ? "Running..." : "Generate Recommendations"}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading decision-operation counts…
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Daily operation counts unavailable
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Query failure is not represented as zero pending work.
                </p>
                {error instanceof Error && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {error.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox
              icon={<Zap className="h-3.5 w-3.5" />}
              label="Today's Recs"
              value={stats.todayRecs}
            />
            <StatBox
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Pending Execution"
              value={stats.pendingExec}
              warn={stats.pendingExec > 0}
            />
            <StatBox
              icon={<CheckCircle className="h-3.5 w-3.5" />}
              label="Missing Outcomes"
              value={stats.missingOutcome}
              warn={stats.missingOutcome > 0}
            />
            <StatBox
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="Overdue Reviews"
              value={stats.overdueReviews}
              destructive={stats.overdueReviews > 0}
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Decision-operation counts are unavailable.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({
  icon,
  label,
  value,
  warn,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warn?: boolean;
  destructive?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        destructive
          ? "border-destructive/30 bg-destructive/5"
          : warn
            ? "border-warning/30 bg-warning/5"
            : "border-border bg-muted/20"
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className={
            destructive
              ? "text-destructive"
              : warn
                ? "text-warning"
                : "text-muted-foreground"
          }
        >
          {icon}
        </span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p
        className={`text-lg font-bold ${
          destructive ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
