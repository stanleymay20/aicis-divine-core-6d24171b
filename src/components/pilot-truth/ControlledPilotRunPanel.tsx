import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { FlaskConical, ShieldCheck, Lock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type RunRow = {
  pilot_run_id: string;
  accepted_by: string;
  accepted_at: string;
  cohort_size: number;
  status: "active" | "completed" | "blocked";
  outcomes_logged_count: number;
  notes: string | null;
  completed_at: string | null;
  accepted_action_ids: string[];
};

type OverrideRow = {
  id: string;
  overridden_by: string;
  reason: string;
  requested_cohort_size: number;
  blocked_reason: string | null;
  created_at: string;
};

export function ControlledPilotRunPanel({ isPrivileged }: { isPrivileged: boolean }) {
  const runs = useQuery({
    queryKey: ["controlled-pilot-runs"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("controlled_pilot_run_status" as any)
        .select("*")
        .order("accepted_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
  });

  const overrides = useQuery({
    queryKey: ["pilot-scaling-overrides"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_scaling_overrides" as any)
        .select("id,overridden_by,reason,requested_cohort_size,blocked_reason,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as OverrideRow[];
    },
  });

  if (!isPrivileged) return null;

  const active = runs.data?.find((r) => r.status === "active");

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-primary" />
          Controlled Pilot Run
        </CardTitle>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Auditable cohort tracker. Each "Accept top 3" creates an immutable pilot run.
          Bulk accepts &gt;3 are blocked until the active run reaches ≥3 logged outcomes,
          unless an admin records an explicit override reason.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {runs.isLoading && <Skeleton className="h-24 w-full" />}

        {!runs.isLoading && (runs.data?.length ?? 0) === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/20">
            No controlled pilot runs yet. Accept the top 3 actions in the Pilot Execution Queue to start one.
          </div>
        )}

        {/* Active run prominent */}
        {active && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/15 text-primary border-primary/30">ACTIVE COHORT</Badge>
                <span className="text-xs text-muted-foreground">
                  started {formatDistanceToNow(new Date(active.accepted_at), { addSuffix: true })}
                </span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                {active.pilot_run_id.slice(0, 8)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">
                Outcomes logged: {active.outcomes_logged_count} / {active.cohort_size}
              </span>
              <span className="text-xs text-muted-foreground">
                {active.outcomes_logged_count >= 3 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Scaling guard cleared
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Bulk &gt;3 blocked
                  </span>
                )}
              </span>
            </div>
            <Progress
              value={Math.min(100, (active.outcomes_logged_count / Math.max(1, active.cohort_size)) * 100)}
              className="h-2"
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {active.accepted_action_ids.map((aid) => (
                <Badge key={aid} variant="outline" className="font-mono text-[10px]">
                  {aid.slice(0, 8)}
                </Badge>
              ))}
            </div>
            {active.notes && (
              <div className="text-xs text-muted-foreground italic">"{active.notes}"</div>
            )}
          </div>
        )}

        {/* Past runs */}
        {(runs.data ?? []).filter((r) => r.status !== "active").length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Past runs
            </div>
            {(runs.data ?? [])
              .filter((r) => r.status !== "active")
              .slice(0, 8)
              .map((r) => (
                <div
                  key={r.pilot_run_id}
                  className="flex items-center justify-between gap-3 p-2 rounded border bg-card/40 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={
                        r.status === "completed"
                          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px]"
                          : "border-amber-500/40 text-[10px]"
                      }
                    >
                      {r.status}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.pilot_run_id.slice(0, 8)}
                    </span>
                    <span className="text-muted-foreground truncate">
                      {r.outcomes_logged_count}/{r.cohort_size} outcomes
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(r.accepted_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Override audit log */}
        {(overrides.data?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              Recent scaling overrides
            </div>
            {(overrides.data ?? []).map((o) => (
              <div
                key={o.id}
                className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] border-amber-500/40">
                    cohort {o.requested_cohort_size}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-foreground/90 italic">"{o.reason}"</div>
                {o.blocked_reason && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    bypassed: {o.blocked_reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
