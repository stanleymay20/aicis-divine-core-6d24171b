import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, CheckCircle, Clock, Play, ChevronRight, Flame,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

interface PendingAction {
  id: string;
  signal_title: string;
  domain: string;
  impact_score: number | null;
  execution_status: string | null;
  created_at: string;
  review_sla_hours: number | null;
}

export function ActionsAwaitingStrip() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: actions = [], isLoading } = useQuery<PendingAction[]>({
    queryKey: ["actions-awaiting"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decision_outcome_log")
        .select("id, signal_title, domain, impact_score, execution_status, created_at, review_sla_hours")
        .in("execution_status", ["not_started", "overdue"])
        .order("impact_score", { ascending: false, nullsFirst: false })
        .limit(5);
      return (data as any) || [];
    },
    staleTime: 30_000,
  });

  const { data: counts } = useQuery({
    queryKey: ["execution-counts"],
    queryFn: async () => {
      const [notStarted, inProgress, completed] = await Promise.all([
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "not_started"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "in_progress"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "completed"),
      ]);
      return {
        pending: notStarted.count || 0,
        active: inProgress.count || 0,
        done: completed.count || 0,
      };
    },
    staleTime: 30_000,
  });

  const executeAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("decision_outcome_log")
        .update({
          execution_status: "in_progress",
          action_taken: true,
          action_taken_at: new Date().toISOString(),
          execution_started_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["actions-awaiting"] });
      queryClient.invalidateQueries({ queryKey: ["execution-counts"] });
      queryClient.invalidateQueries({ queryKey: ["execution-command-records"] });
      queryClient.invalidateQueries({ queryKey: ["business-exposure-strip"] });
      toast.success("Action started — track progress in Actions & Outcomes");
    },
    onError: () => toast.error("Failed to start action"),
  });

  const { data: overdueTotal } = useQuery({
    queryKey: ["overdue-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("decision_outcome_log")
        .select("id", { count: "exact", head: true })
        .eq("execution_status", "overdue");
      return count || 0;
    },
    staleTime: 30_000,
  });

  const executionRate = counts
    ? Math.round(((counts.done) / Math.max(counts.pending + counts.active + counts.done + (overdueTotal || 0), 1)) * 100)
    : 0;

  if (isLoading || actions.length === 0) return null;

  const isOverdue = (action: PendingAction) => {
    if (!action.review_sla_hours) return false;
    const created = new Date(action.created_at).getTime();
    const slaMs = action.review_sla_hours * 3600_000;
    return Date.now() - created > slaMs;
  };

  const overdueCount = actions.filter(isOverdue).length;

  return (
    <Card className={overdueCount > 0 ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold">Actions Awaiting You</span>
            <Badge variant="destructive" className="text-[10px] h-5">
              {counts?.pending || actions.length} pending
            </Badge>
            {overdueCount > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 animate-pulse">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                {overdueCount} overdue
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1 h-7"
            onClick={() => navigate("/decision-ops")}
          >
            View all <ChevronRight className="h-3 w-3" />
          </Button>
        </div>

        {/* Metrics strip */}
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts?.pending || 0}</span> pending
          </span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{overdueTotal || 0}</span> overdue
          </span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts?.active || 0}</span> active
          </span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts?.done || 0}</span> done
          </span>
          <span className={executionRate >= 50 ? "text-emerald-500 font-medium" : "text-amber-500 font-medium"}>
            {executionRate}% execution rate
          </span>
        </div>

        {/* Action items */}
        <div className="space-y-2">
          {actions.map((action) => {
            const overdue = isOverdue(action);
            return (
              <div
                key={action.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                  overdue
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border/50 hover:border-primary/30 hover:bg-primary/5"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{action.signal_title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[9px] h-4">{action.domain}</Badge>
                    {action.impact_score && (
                      <Badge variant="outline" className="text-[9px] h-4">
                        Impact: {action.impact_score}
                      </Badge>
                    )}
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {formatDistanceToNow(new Date(action.created_at), { addSuffix: true })}
                    </span>
                    {overdue && (
                      <Badge variant="destructive" className="text-[9px] h-4 animate-pulse">
                        OVERDUE
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-[10px] px-3 gap-1 shrink-0"
                  onClick={() => executeAction.mutate(action.id)}
                  disabled={executeAction.isPending}
                >
                  <Play className="h-3 w-3" /> Execute
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
