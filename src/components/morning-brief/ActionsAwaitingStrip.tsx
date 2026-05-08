import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, CheckCircle, Clock, Play, ChevronRight, Flame, CheckCheck, X,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

import { getCountryFlagFromIso3 } from "@/lib/geo/country-flags";

interface PendingAction {
  id: string;
  signal_title: string;
  domain: string;
  iso3: string | null;
  impact_score: number | null;
  net_value: number | null;
  roi_estimate: number | null;
  recommended_action: string | null;
  execution_status: string | null;
  created_at: string;
  review_sla_hours: number | null;
}

export function ActionsAwaitingStrip() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["actions-awaiting"] });
    queryClient.invalidateQueries({ queryKey: ["execution-counts"] });
    queryClient.invalidateQueries({ queryKey: ["overdue-count"] });
    queryClient.invalidateQueries({ queryKey: ["execution-command-records"] });
    queryClient.invalidateQueries({ queryKey: ["business-exposure-strip"] });
  };

  const { data: actions = [], isLoading } = useQuery<PendingAction[]>({
    queryKey: ["actions-awaiting"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decision_outcome_log")
        .select("id, signal_title, domain, iso3, impact_score, net_value, roi_estimate, recommended_action, execution_status, created_at, review_sla_hours")
        .in("execution_status", ["not_started", "overdue", "in_progress"])
        .order("impact_score", { ascending: false, nullsFirst: false })
        .limit(60);
      // Strip internal [SIGNAL] / [TAG] prefixes and dedupe by normalized title+domain+iso3
      const clean = (t: string) => (t || "").replace(/^\s*\[[A-Z0-9_\-]+\]\s*/i, "").trim();
      const seen = new Set<string>();
      const unique: PendingAction[] = [];
      for (const row of (data as any[]) || []) {
        const title = clean(row.signal_title);
        const key = `${title.toLowerCase()}|${row.domain || ""}|${row.iso3 || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ ...row, signal_title: title });
        if (unique.length >= 12) break;
      }
      return unique;
    },
    staleTime: 30_000,
  });

  const { data: counts } = useQuery({
    queryKey: ["execution-counts"],
    queryFn: async () => {
      const [notStarted, overdue, inProgress, completed] = await Promise.all([
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "not_started"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "overdue"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "in_progress"),
        supabase.from("decision_outcome_log").select("id", { count: "exact", head: true }).eq("execution_status", "completed"),
      ]);
      return {
        pending: (notStarted.count || 0) + (overdue.count || 0),
        overdue: overdue.count || 0,
        active: inProgress.count || 0,
        done: completed.count || 0,
        total: (notStarted.count || 0) + (overdue.count || 0) + (inProgress.count || 0) + (completed.count || 0),
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
      invalidateAll();
      toast.success("Action started — track progress in Actions & Outcomes");
    },
    onError: () => toast.error("Failed to start action"),
  });

  const completeAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("decision_outcome_log")
        .update({
          execution_status: "completed",
          execution_completed_at: new Date().toISOString(),
          outcome_success: true,
          outcome_timestamp: new Date().toISOString(),
          status: "closed",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Action completed — outcome recorded ✓");
    },
    onError: () => toast.error("Failed to complete action"),
  });

  const dismissAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("decision_outcome_log")
        .update({
          execution_status: "completed",
          execution_completed_at: new Date().toISOString(),
          outcome_success: false,
          outcome_timestamp: new Date().toISOString(),
          status: "closed",
          action_type: "dismissed",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast("Action dismissed", { description: "Marked as not applicable" });
    },
    onError: () => toast.error("Failed to dismiss"),
  });

  const executionRate = counts
    ? Math.round((counts.done / Math.max(counts.total, 1)) * 100)
    : 0;

  if (isLoading || actions.length === 0) return null;

  const isOverdue = (action: PendingAction) => {
    if (action.execution_status === "overdue") return true;
    if (!action.review_sla_hours) return false;
    const created = new Date(action.created_at).getTime();
    const slaMs = action.review_sla_hours * 3600_000;
    return Date.now() - created > slaMs;
  };

  const ageDays = (a: PendingAction) =>
    (Date.now() - new Date(a.created_at).getTime()) / 86_400_000;
  const isStale = (a: PendingAction) =>
    ageDays(a) > 7 && a.execution_status !== "in_progress";

  const fresh = actions.filter((a) => !isStale(a));
  const stale = actions.filter(isStale);

  const overdueCount = fresh.filter(isOverdue).length;
  const isInProgress = (a: PendingAction) => a.execution_status === "in_progress";

  // Severity tier from impact_score
  const severityOf = (s: number | null): { label: string; cls: string } => {
    const v = s ?? 0;
    if (v >= 80) return { label: "CRITICAL", cls: "bg-destructive/20 text-destructive border-destructive/30" };
    if (v >= 60) return { label: "HIGH", cls: "bg-amber-500/20 text-amber-500 border-amber-500/30" };
    if (v >= 40) return { label: "MED", cls: "bg-yellow-500/15 text-yellow-600 border-yellow-500/25" };
    return { label: "LOW", cls: "bg-muted text-muted-foreground border-border" };
  };

  const fmtEuro = (v: number | null) => {
    if (!v || v <= 0) return null;
    if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `€${Math.round(v / 1_000)}K`;
    return `€${Math.round(v)}`;
  };

  const renderRow = (action: PendingAction, opts?: { muted?: boolean }) => {
    const overdue = isOverdue(action);
    const active = isInProgress(action);
    const sev = severityOf(action.impact_score);
    const flag = getCountryFlagFromIso3(action.iso3);
    const euro = fmtEuro(action.net_value ?? action.roi_estimate ?? null);
    const why = action.recommended_action?.trim();
    return (
      <div
        key={action.id}
        className={cn(
          "flex items-start gap-2 p-2.5 rounded-lg border transition-all",
          overdue
            ? "border-destructive/30 bg-destructive/5"
            : active
            ? "border-primary/30 bg-primary/5"
            : opts?.muted
            ? "border-border/40 bg-muted/20 opacity-80"
            : "border-border/50 hover:border-primary/30 hover:bg-primary/5"
        )}
      >
        {/* Severity rail */}
        <Badge variant="outline" className={cn("text-[9px] h-5 px-1.5 font-mono shrink-0 mt-0.5", sev.cls)}>
          {sev.label}
        </Badge>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-base leading-none shrink-0" aria-hidden>{flag}</span>
            <p className="text-xs font-medium truncate">{action.signal_title}</p>
          </div>
          {why && (
            <p className="text-[10px] text-muted-foreground/90 mt-0.5 line-clamp-1">
              <span className="text-muted-foreground/70">Why act: </span>{why}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">{action.domain || "—"}</Badge>
            {euro && (
              <span className="text-[10px] font-mono font-semibold text-foreground tabular-nums">
                {euro}
              </span>
            )}
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatDistanceToNow(new Date(action.created_at), { addSuffix: true })}
            </span>
            {overdue && (
              <Badge variant="destructive" className="text-[9px] h-4 animate-pulse">SLA BREACH</Badge>
            )}
            {active && (
              <Badge className="text-[9px] h-4 bg-primary/20 text-primary border-0">IN PROGRESS</Badge>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {active ? (
            <Button
              size="sm"
              className="h-7 text-[10px] px-2 gap-1 bg-green-600 hover:bg-green-700"
              onClick={() => completeAction.mutate(action.id)}
              disabled={completeAction.isPending}
            >
              <CheckCheck className="h-3 w-3" /> Done
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 text-[10px] px-2 gap-1"
              onClick={() => executeAction.mutate(action.id)}
              disabled={executeAction.isPending}
            >
              <Play className="h-3 w-3" /> Start
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => dismissAction.mutate(action.id)}
            disabled={dismissAction.isPending}
            aria-label="Dismiss — not applicable"
            title="Dismiss — not applicable"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card className={overdueCount > 0 ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}>
      <CardContent className="p-4 space-y-3">
        {/* Header — single source of truth for counts */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-sm font-semibold truncate">Actions Awaiting You</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1 h-7 shrink-0"
            onClick={() => navigate("/evidence-command")}
          >
            View all <ChevronRight className="h-3 w-3" />
          </Button>
        </div>

        {/* Compact metrics row — open queue · overdue · active · done · rate */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums">
          <span className="font-semibold text-destructive">
            {counts?.pending || 0} open
          </span>
          {(counts?.overdue || 0) > 0 && (
            <span className="font-semibold text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {counts?.overdue} overdue
            </span>
          )}
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts?.active || 0}</span> active
          </span>
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{counts?.done || 0}</span> done
          </span>
          <span className={cn(
            "ml-auto font-medium",
            executionRate >= 50 ? "text-primary" : "text-destructive"
          )}>
            {executionRate}% executed
          </span>
        </div>

        {/* Execution rate progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              executionRate >= 50 ? "bg-primary" : executionRate >= 20 ? "bg-yellow-500" : "bg-destructive"
            }`}
            style={{ width: `${Math.max(executionRate, 2)}%` }}
          />
        </div>

        {/* Fresh action items (≤7 days) */}
        {fresh.length > 0 && (
          <div className="space-y-2">
            {fresh.slice(0, 6).map((a) => renderRow(a))}
          </div>
        )}

        {/* Stale lane — backlog older than 7 days */}
        {stale.length > 0 && (
          <details className="group">
            <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1.5 select-none">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              <span>Stale backlog · {stale.length} item{stale.length === 1 ? "" : "s"} older than 7 days</span>
            </summary>
            <div className="space-y-2 mt-2">
              {stale.slice(0, 4).map((a) => renderRow(a, { muted: true }))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
