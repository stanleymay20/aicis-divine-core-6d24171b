import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Clock, Lock, TrendingUp, PlayCircle, ClipboardCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { ActionLifecycleControls } from "@/components/pilot-truth/ActionLifecycleControls";
import { LearningSection } from "@/components/pilot-truth/LearningSection";
import { PilotQueueSection } from "@/components/pilot-truth/PilotQueueSection";
import { ControlledPilotRunPanel } from "@/components/pilot-truth/ControlledPilotRunPanel";

type TruthRow = {
  outcome_id: string | null;
  outcome_recorded_at: string;
  iso3: string | null;
  domain: string | null;
  signal_title: string | null;
  recommended_action: string | null;
  outcome_success: boolean | null;
  measured_impact_score: number | null;
  roi_estimate: number | null;
  net_value: number | null;
  action_id: string | null;
  intervention_title: string | null;
  estimated_roi_eur: number | null;
  action_status: string | null;
  accepted_at: string | null;
  executed_at: string | null;
  dismissed_at: string | null;
  outcome_logged_at: string | null;
  forecast_id: string | null;
  forecast_realized_at: string | null;
  direction_hit: boolean | null;
  absolute_error: number | null;
  evaluation_locked: boolean | null;
  roi_realization_ratio: number | null;
  evidence_quality_score?: number | null;
  evidence_badge?: "strong" | "acceptable" | "weak" | "inconclusive" | null;
  excluded_from_learning?: boolean | null;
};

type StaleAction = {
  id: string;
  country_iso3: string;
  domain: string;
  intervention_title: string;
  urgency_window: string;
  urgency_hours: number;
  estimated_roi_eur: number;
  created_at: string;
  status: "proposed" | "accepted" | "dismissed" | "executed" | "outcome_logged" | "expired";
};

type LifecycleMetrics = {
  proposed_count: number;
  accepted_count: number;
  dismissed_count: number;
  executed_count: number;
  outcome_logged_count: number;
  expired_count: number;
  stale_proposed_count: number;
  action_conversion_rate: number;
};

const fmtEur = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default function PilotTruthFeed() {
  const { user } = useAuth();

  const roles = useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as string);
    },
  });
  const isPrivileged = !!roles.data?.some((r) => r === "admin" || r === "operator");

  const truth = useQuery({
    queryKey: ["pilot-truth-feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_truth_feed" as any)
        .select("*")
        .order("outcome_recorded_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as TruthRow[];
    },
  });

  const stale = useQuery({
    queryKey: ["stale-proposed-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_action_recommendations")
        .select("id,country_iso3,domain,intervention_title,urgency_window,urgency_hours,estimated_roi_eur,created_at,status")
        .in("status", ["proposed", "accepted", "executed"])
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as StaleAction[];
    },
  });

  const metrics = useQuery({
    queryKey: ["risk-action-lifecycle-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_action_lifecycle_metrics" as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as LifecycleMetrics;
    },
  });

  const summary = useQuery({
    queryKey: ["pilot-truth-summary"],
    queryFn: async () => {
      const [outcomes, locked] = await Promise.all([
        supabase.from("decision_outcome_log").select("*", { count: "exact", head: true }),
        supabase.from("forecast_prospective_evaluations").select("*", { count: "exact", head: true }).eq("evaluation_locked", true),
      ]);
      return {
        outcomes: outcomes.count ?? 0,
        lockedForecasts: locked.count ?? 0,
      };
    },
  });

  return (
    <div className="container max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Lock className="h-6 w-6 text-primary" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pilot Truth Feed</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Externally defensible record: every risk action moves through proposed → accepted → executed →
          outcome_logged. Each transition is audit-logged; locked forecasts cannot be edited.
        </p>
        {!isPrivileged && user && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            You are signed in as observer — lifecycle actions are read-only.
          </p>
        )}
      </header>

      {/* Lifecycle metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <SummaryTile icon={<Clock className="h-4 w-4" />} label="Proposed" value={metrics.data?.proposed_count ?? "…"} tone="warn" />
        <SummaryTile icon={<CheckCircle2 className="h-4 w-4" />} label="Accepted" value={metrics.data?.accepted_count ?? "…"} />
        <SummaryTile icon={<PlayCircle className="h-4 w-4" />} label="Executed" value={metrics.data?.executed_count ?? "…"} />
        <SummaryTile icon={<ClipboardCheck className="h-4 w-4" />} label="Outcome Logged" value={metrics.data?.outcome_logged_count ?? "…"} />
        <SummaryTile icon={<AlertTriangle className="h-4 w-4" />} label="Stale Proposed" value={metrics.data?.stale_proposed_count ?? "…"} tone="muted" />
        <SummaryTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Conversion"
          value={metrics.data ? `${(metrics.data.action_conversion_rate * 100).toFixed(0)}%` : "…"}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
        <SummaryTile icon={<CheckCircle2 className="h-4 w-4" />} label="Outcomes Logged (DOL)" value={summary.data?.outcomes ?? "…"} />
        <SummaryTile icon={<Lock className="h-4 w-4" />} label="Locked Forecasts" value={summary.data?.lockedForecasts ?? "…"} />
      </div>

      {/* Phase 1 — Controlled Pilot Run audit panel */}
      <ControlledPilotRunPanel isPrivileged={isPrivileged} />

      {/* Pilot Execution Wave: curated execution surface */}
      <PilotQueueSection isPrivileged={isPrivileged} />

      {/* Active lifecycle queue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-amber-500" />
            Lifecycle Queue ({stale.data?.length ?? 0})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Proposed, accepted, and executed actions. Auto-expiry sweep runs every 30 minutes for proposed items past their urgency window.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {stale.isLoading && <Skeleton className="h-24 w-full" />}
          {stale.data?.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              ✓ No active proposed/accepted/executed actions.
            </div>
          )}
          {stale.data?.slice(0, 25).map((a) => {
            const ageHours = (Date.now() - new Date(a.created_at).getTime()) / 3.6e6;
            const overdue = a.status === "proposed" && ageHours > a.urgency_hours;
            return (
              <div
                key={a.id}
                className="flex flex-col gap-2 p-3 rounded-lg border bg-card/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono text-[10px]">{a.country_iso3}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{a.domain}</Badge>
                    <Badge
                      variant={overdue ? "destructive" : "outline"}
                      className="text-[10px] capitalize"
                    >
                      {a.status}
                    </Badge>
                    <Badge variant={overdue ? "destructive" : "outline"} className="text-[10px]">
                      {a.urgency_window} window
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="text-sm font-medium mt-1 truncate">{a.intervention_title}</div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                      {fmtEur(a.estimated_roi_eur)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">est. ROI</div>
                  </div>
                  <ActionLifecycleControls
                    actionId={a.id}
                    status={a.status}
                    interventionTitle={a.intervention_title}
                    estimatedRoiEur={a.estimated_roi_eur}
                    iso3={a.country_iso3}
                    domain={a.domain}
                    isPrivileged={isPrivileged}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Wave 1C: Action Learning Loop */}
      <LearningSection isPrivileged={isPrivileged} />

      {/* Truth feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            Truth Feed (last 100)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {truth.isLoading && <Skeleton className="h-32 w-full" />}
          {truth.data?.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">No outcomes recorded yet.</div>
          )}
          {truth.data?.slice(0, 30).map((r, i) => (
            <div key={(r.outcome_id ?? r.action_id ?? i) + ""} className="p-3 rounded-lg border bg-card/50 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {r.iso3 && <Badge variant="outline" className="font-mono text-[10px]">{r.iso3}</Badge>}
                {r.domain && <Badge variant="secondary" className="text-[10px]">{r.domain}</Badge>}
                {r.action_status && (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {r.action_status}
                  </Badge>
                )}
                {r.outcome_success === true && (
                  <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                    ✓ Outcome confirmed
                  </Badge>
                )}
                {r.outcome_success === false && (
                  <Badge variant="destructive" className="text-[10px]">✗ Outcome missed</Badge>
                )}
                {r.evaluation_locked && (
                  <Badge className="text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">
                    <Lock className="h-2.5 w-2.5 mr-0.5" /> Locked forecast
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(r.outcome_recorded_at), { addSuffix: true })}
                </span>
              </div>
              {r.signal_title && <div className="text-sm font-medium">{r.signal_title}</div>}
              {r.recommended_action && r.recommended_action !== r.signal_title && (
                <div className="text-xs text-muted-foreground">→ {r.recommended_action}</div>
              )}
              <div className="flex items-center gap-4 text-xs flex-wrap">
                {r.net_value != null && (
                  <span>
                    Realized:{" "}
                    <span className={r.net_value >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {fmtEur(r.net_value)}
                    </span>
                  </span>
                )}
                {r.estimated_roi_eur != null && (
                  <span className="text-muted-foreground">Predicted: {fmtEur(r.estimated_roi_eur)}</span>
                )}
                {r.roi_realization_ratio != null && (
                  <Badge variant="outline" className="text-[10px]">
                    {(r.roi_realization_ratio * 100).toFixed(0)}% realized
                  </Badge>
                )}
                {r.direction_hit === true && (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/40">Direction hit</Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "default" | "warn" | "muted";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/5"
      : tone === "muted"
      ? "border-muted bg-muted/30"
      : "border-border bg-card";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}
