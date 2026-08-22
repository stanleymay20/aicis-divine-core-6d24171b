import { useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PlanetaryOperationsMap } from "@/components/aicis/PlanetaryOperationsMap";
import { RealtimeOperationsStream } from "@/components/aicis/RealtimeOperationsStream";
import { OperationalDecisionWorkflow } from "@/components/aicis/OperationalDecisionWorkflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  DatabaseZap,
  Globe2,
  Network,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";

type KpiRow = {
  global_risk_index: number | null;
  telemetry_coverage_score: number | null;
  active_critical_events: number | null;
  institutional_trust_score: number | null;
  evidence_quality_score: number | null;
};

type ReadinessRow = {
  reliability_score: number | null;
  security_score: number | null;
  observability_score: number | null;
  data_quality_score: number | null;
  telemetry_coverage_score: number | null;
  incident_response_score: number | null;
  overall_enterprise_score: number | null;
  readiness_grade: string | null;
  generated_at: string | null;
};

type InsightRow = {
  severity_band: string | null;
  insight_title: string | null;
  insight_summary: string | null;
  confidence_score: number | null;
  recommended_action: string | null;
  generated_at: string | null;
};

type CommandRow = Record<string, unknown>;

type StageStatus = "active" | "degraded" | "syncing" | "waiting";

const viewQuery = async <T,>(
  view: string,
  limit = 10,
  order?: { column: string; ascending?: boolean },
) => {
  let query = supabase.from(view as never).select("*").limit(limit);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? false });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as T[];
};

const numeric = (value?: number | null) => {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
};

const rounded = (value?: number | null) => {
  const number = numeric(value);
  return number == null ? null : Math.round(number);
};

const scoreTone = (value?: number | null, inverse = false) => {
  const raw = numeric(value);
  if (raw == null) return "border-border bg-muted/20 text-muted-foreground";
  const v = inverse ? 100 - raw : raw;
  if (v >= 80) return "border-emerald-500/30 bg-emerald-500/5 text-emerald-400";
  if (v >= 60) return "border-amber-500/30 bg-amber-500/5 text-amber-400";
  return "border-destructive/30 bg-destructive/5 text-destructive";
};

const severityTone = (severity?: string | null) => {
  const normalized = severity?.toLowerCase() ?? "";
  if (["critical", "high_risk", "failed", "high"].includes(normalized)) {
    return "border-destructive/30 bg-destructive/5 text-destructive";
  }
  if (["strategic", "requires_review", "warning", "medium"].includes(normalized)) {
    return "border-amber-500/30 bg-amber-500/5 text-amber-400";
  }
  if (["cleared", "healthy", "success", "low"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-500/5 text-emerald-400";
  }
  return "border-border bg-muted/20 text-muted-foreground";
};

const stageStatus = ({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error: boolean;
  rows: number;
}): StageStatus => {
  if (loading) return "syncing";
  if (error) return "degraded";
  if (rows > 0) return "active";
  return "waiting";
};

const stageTone: Record<StageStatus, string> = {
  active: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
  degraded: "border-destructive/30 bg-destructive/5 text-destructive",
  syncing: "border-primary/30 bg-primary/5 text-primary",
  waiting: "border-border bg-muted/20 text-muted-foreground",
};

export default function PlanetaryCommandCenter() {
  const navigate = useNavigate();

  const kpis = useQuery({
    queryKey: ["planetary-command-kpis"],
    queryFn: () => viewQuery<KpiRow>("executive_planetary_dashboard_kpis_view", 1),
    refetchInterval: 60_000,
  });
  const readiness = useQuery({
    queryKey: ["planetary-command-readiness"],
    queryFn: () => viewQuery<ReadinessRow>("enterprise_readiness_command_view", 1, { column: "generated_at" }),
    refetchInterval: 60_000,
  });
  const insights = useQuery({
    queryKey: ["planetary-command-insights"],
    queryFn: () => viewQuery<InsightRow>("executive_planetary_insights_view", 5, { column: "generated_at" }),
    refetchInterval: 60_000,
  });
  const telemetry = useQuery({
    queryKey: ["planetary-command-telemetry"],
    queryFn: () => viewQuery<CommandRow>("telemetry_backbone_command_view", 8),
    refetchInterval: 45_000,
  });
  const agents = useQuery({
    queryKey: ["planetary-command-agents"],
    queryFn: () => viewQuery<CommandRow>("agent_task_command_view", 8),
    refetchInterval: 60_000,
  });
  const causal = useQuery({
    queryKey: ["planetary-command-causal"],
    queryFn: () => viewQuery<CommandRow>("planetary_causal_command_view", 8),
    refetchInterval: 60_000,
  });
  const interventions = useQuery({
    queryKey: ["planetary-command-interventions"],
    queryFn: () => viewQuery<CommandRow>("intervention_governance_command_view", 8),
    refetchInterval: 60_000,
  });
  const memory = useQuery({
    queryKey: ["planetary-command-memory"],
    queryFn: () => viewQuery<CommandRow>("memory_forecast_command_view", 8),
    refetchInterval: 120_000,
  });

  const kpi = kpis.data?.[0];
  const ready = readiness.data?.[0];
  const topInsight = insights.data?.[0];

  const summary = useMemo(
    () => ({
      risk: rounded(kpi?.global_risk_index),
      readiness: rounded(ready?.overall_enterprise_score),
      coverage: rounded(kpi?.telemetry_coverage_score ?? ready?.telemetry_coverage_score),
      critical: rounded(kpi?.active_critical_events),
      evidence: rounded(kpi?.evidence_quality_score),
      trust: rounded(kpi?.institutional_trust_score),
    }),
    [kpi, ready],
  );

  const stages = [
    {
      id: "sense",
      label: "Sense",
      description: "Collect public-source telemetry and events",
      icon: Radio,
      rows: telemetry.data?.length ?? 0,
      loading: telemetry.isLoading,
      error: telemetry.isError,
      route: "/live",
    },
    {
      id: "fuse",
      label: "Fuse",
      description: "Resolve, normalize and connect observations",
      icon: DatabaseZap,
      rows: summary.coverage != null ? 1 : 0,
      loading: kpis.isLoading || readiness.isLoading,
      error: kpis.isError && readiness.isError,
      route: "/data-pipeline",
    },
    {
      id: "understand",
      label: "Understand",
      description: "Estimate risk, causality and trajectories",
      icon: Network,
      rows: causal.data?.length ?? 0,
      loading: causal.isLoading,
      error: causal.isError,
      route: "/intelligence-engine",
    },
    {
      id: "decide",
      label: "Decide",
      description: "Form judgments, task agents and govern choices",
      icon: BrainCircuit,
      rows: (insights.data?.length ?? 0) + (agents.data?.length ?? 0),
      loading: insights.isLoading || agents.isLoading,
      error: insights.isError || agents.isError,
      route: "/decision-ops",
    },
    {
      id: "act",
      label: "Act",
      description: "Coordinate approved interventions and follow-through",
      icon: Zap,
      rows: interventions.data?.length ?? 0,
      loading: interventions.isLoading,
      error: interventions.isError,
      route: "/predictions",
    },
    {
      id: "learn",
      label: "Learn",
      description: "Compare forecasts with outcomes and retain memory",
      icon: RefreshCw,
      rows: memory.data?.length ?? 0,
      loading: memory.isLoading,
      error: memory.isError,
      route: "/learning-loop",
    },
  ];

  const nextAction =
    topInsight?.recommended_action ??
    "Continue sensing and evidence collection until a governed action is recommended.";

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 p-4 md:p-6 xl:p-8 animate-fade-in">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-background/72 px-5 py-5 backdrop-blur-sm md:px-7 md:py-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-primary/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full border border-primary/15" />
        <div aria-hidden="true" className="pointer-events-none absolute right-12 top-6 h-24 w-24 rounded-full border border-primary/20" />

        <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/25 bg-primary/5 text-primary text-[10px] tracking-[0.16em]">
                PLANETARY CORE
              </Badge>
              <Badge variant="outline" className="border-border/80 bg-background/60 text-[10px] text-muted-foreground">
                HUMAN-GOVERNED INTELLIGENCE
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-primary/5">
                <div className="absolute inset-2 rounded-full border border-primary/15" />
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl xl:text-4xl">Planetary Nervous System</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-base">
                  Sense globally. Resolve evidence. Understand causality. Coordinate governed action. Learn from outcomes.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Button variant="outline" size="sm" onClick={() => navigate("/morning-brief")}>
              Executive brief
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/risk-atlas")}>
              Planetary field
            </Button>
            <Button size="sm" onClick={() => navigate("/intelligence-engine")}>
              Ask AICIS
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="system-pulse-title" className="rounded-2xl border border-border/70 bg-card/55 backdrop-blur-sm">
        <div className="flex flex-col gap-4 border-b border-border/60 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div id="system-pulse-title" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Activity className="h-4 w-4 text-primary" />
              Planetary state
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Current operational posture from the executive and readiness views.</p>
          </div>
          {ready?.generated_at && (
            <div className="text-[10px] font-mono text-muted-foreground">
              READINESS SNAPSHOT {new Date(ready.generated_at).toLocaleString()}
            </div>
          )}
        </div>

        <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-6 lg:divide-x">
          <PulseMetric
            icon={<Globe2 className="h-4 w-4" />}
            label="Global risk"
            value={summary.risk}
            suffix="/100"
            tone={scoreTone(summary.risk, true)}
            loading={kpis.isLoading}
          />
          <PulseMetric
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Critical events"
            value={summary.critical}
            tone={summary.critical == null ? scoreTone(null) : severityTone(summary.critical > 0 ? "critical" : "healthy")}
            loading={kpis.isLoading}
          />
          <PulseMetric
            icon={<Radio className="h-4 w-4" />}
            label="Coverage"
            value={summary.coverage}
            suffix="%"
            tone={scoreTone(summary.coverage)}
            loading={kpis.isLoading || readiness.isLoading}
          />
          <PulseMetric
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Evidence"
            value={summary.evidence}
            suffix="/100"
            tone={scoreTone(summary.evidence)}
            loading={kpis.isLoading}
          />
          <PulseMetric
            icon={<Workflow className="h-4 w-4" />}
            label="Institutional trust"
            value={summary.trust}
            suffix="/100"
            tone={scoreTone(summary.trust)}
            loading={kpis.isLoading}
          />
          <PulseMetric
            icon={<Activity className="h-4 w-4" />}
            label="System readiness"
            value={summary.readiness}
            suffix="/100"
            tone={scoreTone(summary.readiness)}
            loading={readiness.isLoading}
          />
        </div>
      </section>

      <section aria-labelledby="neural-flow-title" className="rounded-2xl border border-border/70 bg-background/65 p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div id="neural-flow-title" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <BrainCircuit className="h-4 w-4 text-primary" />
              Neural flow
            </div>
            <p className="mt-1 text-sm text-muted-foreground">The operational loop is visible end-to-end; each stage reports only what its backing query confirms.</p>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">SENSE → FUSE → UNDERSTAND → DECIDE → ACT → LEARN</div>
        </div>

        <div className="grid gap-2 md:grid-cols-3 2xl:grid-cols-6">
          {stages.map((stage, index) => {
            const status = stageStatus({ loading: stage.loading, error: stage.error, rows: stage.rows });
            const Icon = stage.icon;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => navigate(stage.route)}
                className="group relative min-h-36 rounded-xl border border-border/70 bg-card/45 p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <Badge variant="outline" className={`text-[9px] uppercase tracking-wider ${stageTone[status]}`}>
                    {status}
                  </Badge>
                </div>
                <div className="mt-4 text-sm font-semibold">{stage.label}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.description}</p>
                <div className="mt-3 text-[10px] font-mono text-muted-foreground">
                  {stage.loading ? "checking…" : stage.error ? "query unavailable" : `${stage.rows} recent evidence row${stage.rows === 1 ? "" : "s"}`}
                </div>
                {index < stages.length - 1 && (
                  <ArrowRight aria-hidden="true" className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-border 2xl:block" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 2xl:grid-cols-[1.55fr_0.75fr]">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/50">
          <div className="flex flex-col gap-2 border-b border-border/60 px-5 py-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <Globe2 className="h-4 w-4 text-primary" />
                Planetary field
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Spatial context for active risks, signals and operational attention.</p>
            </div>
            <Button variant="ghost" size="sm" className="self-start text-xs md:self-auto" onClick={() => navigate("/risk-atlas")}>
              Open full atlas <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="p-2 md:p-3">
            <PlanetaryOperationsMap />
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/50 p-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Current judgment
          </div>

          {insights.isLoading ? (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : insights.isError ? (
            <UnavailableState text="Executive judgment view is unavailable. No fallback judgment is being fabricated." />
          ) : topInsight ? (
            <div className="mt-4">
              <div className="flex flex-wrap items-start gap-2">
                <h2 className="min-w-0 flex-1 text-xl font-semibold leading-tight">{topInsight.insight_title || "Untitled executive judgment"}</h2>
                <Badge variant="outline" className={severityTone(topInsight.severity_band)}>
                  {topInsight.severity_band || "unclassified"}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {topInsight.insight_summary || "No narrative summary was supplied by the intelligence view."}
              </p>
              {numeric(topInsight.confidence_score) != null && (
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                  <span className="text-muted-foreground">Judgment confidence</span>
                  <span className="font-mono">{Math.round(Number(topInsight.confidence_score))}%</span>
                </div>
              )}
            </div>
          ) : (
            <UnavailableState text="No executive judgment is currently available." />
          )}

          <div className="mt-5 rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Governed next action</div>
            <p className="mt-2 text-sm font-medium leading-relaxed">{nextAction}</p>
            <Button variant="ghost" size="sm" className="mt-3 -ml-2 h-8 text-xs" onClick={() => navigate("/decision-ops")}>
              Inspect decision path <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-card/50 p-2 md:p-3">
        <div className="px-3 pb-3 pt-2 md:px-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Workflow className="h-4 w-4 text-primary" />
            Decision membrane
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Evidence becomes a decision only through an explicit, reviewable workflow.</p>
        </div>
        <OperationalDecisionWorkflow />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="rounded-2xl border border-border/70 bg-card/50 p-2 md:p-3">
          <div className="px-3 pb-3 pt-2 md:px-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Radio className="h-4 w-4 text-primary" />
              Nerve traffic
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Recent operational events moving through the system.</p>
          </div>
          <RealtimeOperationsStream />
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/50 p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                System integrity
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Operational health, not a compliance certification.</p>
            </div>
            {ready?.readiness_grade && (
              <Badge variant="outline" className={scoreTone(ready.overall_enterprise_score)}>
                {ready.readiness_grade}
              </Badge>
            )}
          </div>

          {readiness.isLoading ? (
            <Skeleton className="mt-5 h-44 w-full" />
          ) : readiness.isError ? (
            <UnavailableState text="Readiness view is unavailable." />
          ) : ready ? (
            <div className="mt-5 space-y-4">
              <IntegrityLine label="Reliability" value={ready.reliability_score} />
              <IntegrityLine label="Security" value={ready.security_score} />
              <IntegrityLine label="Observability" value={ready.observability_score} />
              <IntegrityLine label="Data quality" value={ready.data_quality_score} />
              <IntegrityLine label="Incident response" value={ready.incident_response_score} />
            </div>
          ) : (
            <UnavailableState text="No readiness snapshot has been produced yet." />
          )}
        </div>
      </section>
    </div>
  );
}

function PulseMetric({
  icon,
  label,
  value,
  suffix = "",
  tone,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: number | null;
  suffix?: string;
  tone: string;
  loading?: boolean;
}) {
  return (
    <div className="min-h-28 px-4 py-4 lg:px-5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-8 w-20" />
      ) : (
        <div className="mt-4 flex items-end justify-between gap-2">
          <div className="text-2xl font-semibold tabular-nums">
            {value == null ? "—" : value}
            {value != null && suffix && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{suffix}</span>}
          </div>
          <span className={`h-2 w-2 rounded-full border ${tone}`} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function IntegrityLine({ label, value }: { label: string; value?: number | null }) {
  const v = rounded(value);
  const width = v == null ? 0 : Math.max(0, Math.min(100, v));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{v == null ? "—" : `${v}/100`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/70">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function UnavailableState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-background/35 p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}
