import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PlanetaryOperationsMap } from "@/components/aicis/PlanetaryOperationsMap";
import { RealtimeOperationsStream } from "@/components/aicis/RealtimeOperationsStream";
import { OperationalDecisionWorkflow } from "@/components/aicis/OperationalDecisionWorkflow";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const insights = useQuery({ queryKey: ["planetary-command-insights"], queryFn: () => viewQuery<InsightRow>("executive_planetary_insights_view", 5), refetchInterval: 60_000 });
  const telemetry = useQuery({ queryKey: ["planetary-command-telemetry"], queryFn: () => viewQuery<SimpleCommandRow>("telemetry_backbone_command_view", 8), refetchInterval: 45_000 });
  const agents = useQuery({ queryKey: ["planetary-command-agents"], queryFn: () => viewQuery<SimpleCommandRow>("agent_task_command_view", 8), refetchInterval: 60_000 });
  const causal = useQuery({ queryKey: ["planetary-command-causal"], queryFn: () => viewQuery<SimpleCommandRow>("planetary_causal_command_view", 8), refetchInterval: 60_000 });
  const interventions = useQuery({ queryKey: ["planetary-command-interventions"], queryFn: () => viewQuery<SimpleCommandRow>("intervention_governance_command_view", 8), refetchInterval: 60_000 });
  const memory = useQuery({ queryKey: ["planetary-command-memory"], queryFn: () => viewQuery<SimpleCommandRow>("memory_forecast_command_view", 8), refetchInterval: 120_000 });
  const briefings = useQuery({ queryKey: ["planetary-command-briefings"], queryFn: () => viewQuery<SimpleCommandRow>("executive_briefing_command_view", 5), refetchInterval: 120_000 });
  const translations = useQuery({ queryKey: ["planetary-command-translations"], queryFn: () => viewQuery<SimpleCommandRow>("translation_operations_command_view", 6), refetchInterval: 120_000 });

  const kpi = kpis.data?.[0];
  const ready = readiness.data?.[0];
  const topInsight = insights.data?.[0];
  const topAction = topInsight?.recommended_action ?? "Monitor live operations and review the highest severity signal.";
  const summary = useMemo(() => ({ risk: formatScore(kpi?.global_risk_index), readinessScore: formatScore(ready?.overall_enterprise_score), coverage: formatScore(kpi?.telemetry_coverage_score ?? ready?.telemetry_coverage_score), critical: formatScore(kpi?.active_critical_events) }), [kpi, ready]);

  return <AICISLayout><div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto h-full overflow-y-auto space-y-5 animate-fade-in"><div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4"><div><div className="flex items-center gap-2 flex-wrap"><Globe2 className="h-6 w-6 text-primary" /><h1 className="text-2xl md:text-3xl font-semibold tracking-tight">AICIS Command</h1><Badge variant="outline" className="uppercase tracking-wider text-[10px]">Operational</Badge></div><p className="text-sm text-muted-foreground mt-2 max-w-2xl">What is happening, why it matters, and what to do next.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => navigate("/morning-brief")}>Brief</Button><Button variant="outline" size="sm" onClick={() => navigate("/data-pipeline")}>Pipeline</Button><Button size="sm" onClick={() => navigate("/intelligence-engine")}>Ask</Button></div></div><Card className="border-border bg-card/80"><CardContent className="p-4 md:p-5"><div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.5fr] gap-4 items-stretch"><div className="space-y-3"><div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" /> Current judgment</div>{insights.isLoading ? <Skeleton className="h-28 w-full" /> : <div><div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-semibold leading-tight">{topInsight?.insight_title ?? "No executive judgment generated yet"}</h2><Badge variant="outline" className={severityTone(topInsight?.severity_band)}>{topInsight?.severity_band ?? "monitor"}</Badge></div><p className="text-sm text-muted-foreground mt-2 line-clamp-3">{topInsight?.insight_summary ?? "Run the executive dashboard cycle to generate the current operational judgment."}</p></div>}<div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="text-xs uppercase tracking-wider text-primary mb-1">Next best action</div><p className="text-sm font-medium">{topAction}</p></div></div><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><MetricCard icon={<Activity className="h-4 w-4" />} label="Risk" value={summary.risk} suffix="/100" tone={toneForScore(100 - summary.risk)} loading={kpis.isLoading} /><MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="Critical" value={summary.critical} suffix="" tone={severityTone(summary.critical > 0 ? "critical" : "cleared")} loading={kpis.isLoading} /><MetricCard icon={<DatabaseZap className="h-4 w-4" />} label="Coverage" value={summary.coverage} suffix="%" tone={toneForScore(summary.coverage)} loading={kpis.isLoading || readiness.isLoading} /><MetricCard icon={<ShieldCheck className="h-4 w-4" />} label="Ready" value={summary.readinessScore} suffix="/100" tone={toneForScore(summary.readinessScore)} loading={readiness.isLoading} /></div></div></CardContent></Card><OperationalDecisionWorkflow /><PlanetaryOperationsMap /><div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><div className="xl:col-span-2"><RealtimeOperationsStream /></div><Card className="border-border bg-card/70"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Readiness</CardTitle><CardDescription>Only the essential health posture.</CardDescription></CardHeader><CardContent className="space-y-3">{readiness.isLoading ? <Skeleton className="h-44 w-full" /> : ready ? <><div className="flex items-center justify-between rounded-lg border border-border p-3 bg-background/40"><span className="text-sm text-muted-foreground">Grade</span><Badge variant="outline" className={toneForScore(ready.overall_enterprise_score)}>{ready.readiness_grade ?? "unknown"}</Badge></div><ScoreLine label="Reliability" value={ready.reliability_score} /><ScoreLine label="Security" value={ready.security_score} /><ScoreLine label="Observability" value={ready.observability_score} /><ScoreLine label="Data Quality" value={ready.data_quality_score} /></> : <EmptyState text="No scorecard yet. Run run_enterprise_hardening_cycle()." />}</CardContent></Card></div></div></AICISLayout>;
}

function MetricCard({ icon, label, value, suffix, tone, loading }: { icon: React.ReactNode; label: string; value: number; suffix: string; tone: string; loading?: boolean }) { return <Card className="border-border bg-card/70"><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">{icon}{label}</div><Badge variant="outline" className={tone}>Live</Badge></div>{loading ? <Skeleton className="h-8 w-20 mt-3" /> : <div className="text-2xl font-semibold mt-3">{value}<span className="text-sm text-muted-foreground">{suffix}</span></div>}</CardContent></Card>; }
function ScoreLine({ label, value }: { label: string; value?: number | null }) { const v = formatScore(value); return <div className="space-y-1"><div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{v}/100</span></div><div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div></div>; }
function EmptyState({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-border bg-background/30 p-4 text-sm text-muted-foreground flex items-start gap-2"><ClipboardList className="h-4 w-4 mt-0.5 shrink-0" /><span>{text}</span></div>; }
