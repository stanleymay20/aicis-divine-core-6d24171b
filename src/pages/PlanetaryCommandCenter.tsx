import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PlanetaryOperationsMap } from "@/components/aicis/PlanetaryOperationsMap";
import { RealtimeOperationsStream } from "@/components/aicis/RealtimeOperationsStream";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, ClipboardList, DatabaseZap, FileText, Globe2, Languages, Network, ShieldCheck, Sparkles, Workflow } from "lucide-react";

type KpiRow = { global_risk_index: number | null; telemetry_coverage_score: number | null; active_critical_events: number | null; institutional_trust_score: number | null; evidence_quality_score: number | null; };
type ReadinessRow = { reliability_score: number | null; security_score: number | null; observability_score: number | null; data_quality_score: number | null; telemetry_coverage_score: number | null; incident_response_score: number | null; overall_enterprise_score: number | null; readiness_grade: string | null; generated_at: string | null; };
type InsightRow = { severity_band: string | null; insight_title: string | null; insight_summary: string | null; confidence_score: number | null; recommended_action: string | null; generated_at: string | null; };
type SimpleCommandRow = Record<string, any>;

const viewQuery = async <T,>(view: string, limit = 10, order?: { column: string; ascending?: boolean }) => {
  let query = supabase.from(view as any).select("*").limit(limit);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? false });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as T[];
};

const formatScore = (value?: number | null) => Math.round(Number(value ?? 0));
const toneForScore = (value?: number | null) => {
  const v = Number(value ?? 0);
  if (v >= 80) return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
  if (v >= 60) return "text-amber-300 bg-amber-500/10 border-amber-500/30";
  return "text-rose-300 bg-rose-500/10 border-rose-500/30";
};
const severityTone = (severity?: string | null) => {
  if (severity === "critical" || severity === "high_risk" || severity === "failed") return "bg-rose-500/10 text-rose-300 border-rose-500/30";
  if (severity === "strategic" || severity === "requires_review" || severity === "warning") return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  if (severity === "cleared" || severity === "healthy" || severity === "success") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  return "bg-muted text-muted-foreground border-border";
};

export default function PlanetaryCommandCenter() {
  const navigate = useNavigate();
  const kpis = useQuery({ queryKey: ["planetary-command-kpis"], queryFn: () => viewQuery<KpiRow>("executive_planetary_dashboard_kpis_view", 1), refetchInterval: 60_000 });
  const readiness = useQuery({ queryKey: ["planetary-command-readiness"], queryFn: () => viewQuery<ReadinessRow>("enterprise_readiness_command_view", 1, { column: "generated_at" }), refetchInterval: 60_000 });
  const insights = useQuery({ queryKey: ["planetary-command-insights"], queryFn: () => viewQuery<InsightRow>("executive_planetary_insights_view", 8), refetchInterval: 60_000 });
  const telemetry = useQuery({ queryKey: ["planetary-command-telemetry"], queryFn: () => viewQuery<SimpleCommandRow>("telemetry_backbone_command_view", 8), refetchInterval: 45_000 });
  const agents = useQuery({ queryKey: ["planetary-command-agents"], queryFn: () => viewQuery<SimpleCommandRow>("agent_task_command_view", 8), refetchInterval: 60_000 });
  const causal = useQuery({ queryKey: ["planetary-command-causal"], queryFn: () => viewQuery<SimpleCommandRow>("planetary_causal_command_view", 8), refetchInterval: 60_000 });
  const interventions = useQuery({ queryKey: ["planetary-command-interventions"], queryFn: () => viewQuery<SimpleCommandRow>("intervention_governance_command_view", 8), refetchInterval: 60_000 });
  const memory = useQuery({ queryKey: ["planetary-command-memory"], queryFn: () => viewQuery<SimpleCommandRow>("memory_forecast_command_view", 8), refetchInterval: 120_000 });
  const briefings = useQuery({ queryKey: ["planetary-command-briefings"], queryFn: () => viewQuery<SimpleCommandRow>("executive_briefing_command_view", 5), refetchInterval: 120_000 });
  const translations = useQuery({ queryKey: ["planetary-command-translations"], queryFn: () => viewQuery<SimpleCommandRow>("translation_operations_command_view", 6), refetchInterval: 120_000 });

  const kpi = kpis.data?.[0];
  const ready = readiness.data?.[0];
  const summary = useMemo(() => ({
    risk: formatScore(kpi?.global_risk_index),
    readinessScore: formatScore(ready?.overall_enterprise_score),
    coverage: formatScore(kpi?.telemetry_coverage_score ?? ready?.telemetry_coverage_score),
  }), [kpi, ready]);

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1500px] mx-auto h-full overflow-y-auto space-y-5 animate-fade-in">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Globe2 className="h-6 w-6 text-primary" />
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Planetary Command Center</h1>
              <Badge variant="outline" className="uppercase tracking-wider text-[10px]">Enterprise UI</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl">Unified operational view for executive KPIs, realtime telemetry, spatial risk, causal propagation, intervention governance, memory, briefings, translation, and multi-agent coordination.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/morning-brief")}>Morning Brief</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/data-pipeline")}>Pipeline Health</Button>
            <Button size="sm" onClick={() => navigate("/intelligence-engine")}>Ask AICIS</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard icon={<Activity className="h-4 w-4" />} label="Global Risk" value={summary.risk} suffix="/100" tone={toneForScore(100 - summary.risk)} loading={kpis.isLoading} />
          <MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Enterprise Readiness" value={summary.readinessScore} suffix="/100" tone={toneForScore(summary.readinessScore)} loading={readiness.isLoading} />
          <MetricCard icon={<DatabaseZap className="h-4 w-4" />} label="Telemetry Coverage" value={summary.coverage} suffix="%" tone={toneForScore(summary.coverage)} loading={kpis.isLoading || readiness.isLoading} />
          <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="Critical Events" value={formatScore(kpi?.active_critical_events)} suffix="" tone={severityTone((kpi?.active_critical_events ?? 0) > 0 ? "critical" : "cleared")} loading={kpis.isLoading} />
        </div>

        <PlanetaryOperationsMap />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2"><RealtimeOperationsStream /></div>
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Readiness</CardTitle><CardDescription>Commercial enterprise posture.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {readiness.isLoading ? <Skeleton className="h-48 w-full" /> : ready ? <>
                <div className="flex items-center justify-between rounded-lg border border-border p-3 bg-background/40"><span className="text-sm text-muted-foreground">Grade</span><Badge variant="outline" className={toneForScore(ready.overall_enterprise_score)}>{ready.readiness_grade ?? "unknown"}</Badge></div>
                <ScoreLine label="Reliability" value={ready.reliability_score} /><ScoreLine label="Security" value={ready.security_score} /><ScoreLine label="Observability" value={ready.observability_score} /><ScoreLine label="Data Quality" value={ready.data_quality_score} /><ScoreLine label="Incident Response" value={ready.incident_response_score} />
              </> : <EmptyState text="No enterprise readiness scorecard yet. Run run_enterprise_hardening_cycle()." />}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Executive Intelligence</CardTitle><CardDescription>Current boardroom-ready judgments generated from the backend intelligence layer.</CardDescription></CardHeader>
          <CardContent><CommandList loading={insights.isLoading} empty="No executive insights generated yet. Run run_executive_dashboard_cycle() after applying migrations." rows={(insights.data ?? []).map((r) => ({ title: r.insight_title ?? "Untitled insight", meta: r.severity_band ?? "monitor", summary: r.insight_summary ?? "No summary available.", badgeTone: severityTone(r.severity_band), footer: r.recommended_action }))} /></CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          <SurfaceCard icon={<DatabaseZap className="h-4 w-4 text-primary" />} title="Telemetry Backbone" loading={telemetry.isLoading} empty="No telemetry backbone events yet." rows={(telemetry.data ?? []).map((r) => ({ title: `${r.event_status ?? "unknown"} · ${r.source_domain ?? "domain"}`, meta: `shard ${r.shard_key ?? 0}`, summary: `${r.event_count ?? 0} events · avg priority ${r.avg_priority ?? 0}`, badgeTone: severityTone(r.event_status === "failed" ? "critical" : r.event_status === "queued" ? "strategic" : "healthy") }))} />
          <SurfaceCard icon={<Network className="h-4 w-4 text-primary" />} title="Causal Propagation" loading={causal.isLoading} empty="No causal propagation events yet." rows={(causal.data ?? []).map((r) => ({ title: r.source_event ?? "Propagation event", meta: r.projected_time_window ?? "window", summary: `${r.source_domain ?? "domain"} → ${r.impacted_system ?? "system"} · probability ${r.impact_probability ?? 0}`, badgeTone: severityTone((r.impact_severity ?? 0) >= 75 ? "critical" : "strategic") }))} />
          <SurfaceCard icon={<ShieldCheck className="h-4 w-4 text-primary" />} title="Intervention Governance" loading={interventions.isLoading} empty="No intervention governance workflows yet." rows={(interventions.data ?? []).map((r) => ({ title: r.simulation_name ?? "Simulation", meta: r.approval_status ?? "pending", summary: `Safety: ${r.safety_rating ?? "unknown"} · confidence ${r.confidence_score ?? 0}`, badgeTone: severityTone(r.safety_rating) }))} />
          <SurfaceCard icon={<BrainCircuit className="h-4 w-4 text-primary" />} title="Planetary Memory" loading={memory.isLoading} empty="No memory-informed forecasts yet." rows={(memory.data ?? []).map((r) => ({ title: r.source_event ?? "Memory forecast", meta: r.projected_risk_trend ?? "trend", summary: `${r.historical_analog_count ?? 0} analogs · confidence ${r.forecast_confidence ?? 0}`, badgeTone: toneForScore(r.forecast_confidence) }))} />
          <SurfaceCard icon={<Workflow className="h-4 w-4 text-primary" />} title="Agent Coordination" loading={agents.isLoading} empty="No agent tasks delegated yet." rows={(agents.data ?? []).map((r) => ({ title: r.assigned_agent_key ?? "Agent task", meta: r.operational_priority ?? "medium", summary: `${r.task_type ?? "task"} · ${r.source_domain ?? "domain"}`, badgeTone: severityTone(r.operational_priority === "critical" ? "critical" : r.operational_priority === "high" ? "strategic" : "monitor") }))} />
          <SurfaceCard icon={<FileText className="h-4 w-4 text-primary" />} title="Executive Briefings" loading={briefings.isLoading} empty="No executive briefings generated yet." rows={(briefings.data ?? []).map((r) => ({ title: r.report_title ?? "Briefing", meta: r.report_status ?? "draft", summary: `${r.report_type ?? "report"} · risk ${r.global_risk_index ?? 0} · evidence ${r.evidence_quality_score ?? 0}`, badgeTone: severityTone(r.report_status === "published" ? "success" : "strategic") }))} />
        </div>

        <Card className="border-border bg-card/70"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Languages className="h-4 w-4 text-primary" /> Translation Operations</CardTitle><CardDescription>Language localization queue so global intelligence becomes useful to each user.</CardDescription></CardHeader><CardContent><CommandList loading={translations.isLoading} empty="No translation queue activity yet. Run run_translation_intelligence_cycle()." rows={(translations.data ?? []).map((r) => ({ title: `${r.target_language_code ?? "language"} · ${r.queue_status ?? "status"}`, meta: `${r.item_count ?? 0} items`, summary: `Average priority ${r.avg_priority ?? 0}`, badgeTone: severityTone(r.queue_status === "queued" ? "strategic" : r.queue_status === "completed" ? "healthy" : "monitor") }))} /></CardContent></Card>
      </div>
    </AICISLayout>
  );
}

function MetricCard({ icon, label, value, suffix, tone, loading }: { icon: React.ReactNode; label: string; value: number; suffix: string; tone: string; loading?: boolean }) { return <Card className="border-border bg-card/70"><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">{icon}{label}</div><Badge variant="outline" className={tone}>Live</Badge></div>{loading ? <Skeleton className="h-8 w-24 mt-3" /> : <div className="text-3xl font-semibold mt-3">{value}<span className="text-base text-muted-foreground">{suffix}</span></div>}</CardContent></Card>; }
function ScoreLine({ label, value }: { label: string; value?: number | null }) { const v = formatScore(value); return <div className="space-y-1"><div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{v}/100</span></div><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div></div>; }
function SurfaceCard({ icon, title, loading, empty, rows }: { icon: React.ReactNode; title: string; loading: boolean; empty: string; rows: Array<{ title: string; meta?: string; summary?: string; badgeTone?: string }> }) { return <Card className="border-border bg-card/70 min-h-[320px]"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle></CardHeader><CardContent><CommandList loading={loading} empty={empty} rows={rows} compact /></CardContent></Card>; }
function CommandList({ loading, empty, rows, compact = false }: { loading: boolean; empty: string; compact?: boolean; rows: Array<{ title: string; meta?: string; summary?: string; badgeTone?: string; footer?: string | null }> }) { if (loading) return <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>; if (!rows.length) return <EmptyState text={empty} />; return <ScrollArea className={compact ? "h-[230px] pr-2" : "h-[310px] pr-2"}><div className="space-y-2">{rows.map((row, idx) => <div key={`${row.title}-${idx}`} className="rounded-lg border border-border bg-background/40 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium truncate">{row.title}</p>{row.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.summary}</p>}{row.footer && <p className="text-xs text-primary mt-2 line-clamp-1">{row.footer}</p>}</div>{row.meta && <Badge variant="outline" className={`shrink-0 text-[10px] ${row.badgeTone ?? ""}`}>{row.meta}</Badge>}</div></div>)}</div></ScrollArea>; }
function EmptyState({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-border bg-background/30 p-4 text-sm text-muted-foreground flex items-start gap-2"><ClipboardList className="h-4 w-4 mt-0.5 shrink-0" /><span>{text}</span></div>; }
