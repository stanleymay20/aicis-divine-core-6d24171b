import { useState } from "react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, HelpCircle, Database,
  TrendingUp, Shield, Radio, Globe, Loader2, RefreshCw, BarChart3, Cpu
} from "lucide-react";

type MetricStatus = "pass" | "warn" | "fail" | "no_data";

interface ScorecardMetric {
  label: string;
  value: string | number;
  target: string;
  status: MetricStatus;
  detail?: string;
}

function StatusDot({ status }: { status: MetricStatus }) {
  return (
    <div className={cn(
      "h-2.5 w-2.5 rounded-full shrink-0",
      status === "pass" && "bg-emerald-500",
      status === "warn" && "bg-amber-500",
      status === "fail" && "bg-red-500",
      status === "no_data" && "bg-muted-foreground/40",
    )} />
  );
}

function MetricRow({ metric }: { metric: ScorecardMetric }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/30 last:border-0">
      <StatusDot status={metric.status} />
      <span className="text-xs flex-1 truncate">{metric.label}</span>
      <span className="text-xs font-mono font-bold w-16 text-right">{metric.value}</span>
      <span className="text-[10px] text-muted-foreground w-16 text-right">{metric.target}</span>
    </div>
  );
}

function usePipelineMetrics() {
  return useQuery({
    queryKey: ["signal-validation-pipeline"],
    queryFn: async () => {
      const [
        connectorRes,
        signalsRes,
        feedbackRes,
        decisionsRes,
        coverageRes,
        benchmarksRes,
        registryRes,
      ] = await Promise.all([
        supabase.from("source_connector_runs").select("*").order("run_at", { ascending: false }).limit(50),
        supabase.from("global_signals").select("id, enrichment_status, source_trust_tier, official_source_present, multi_source_confirmed, impact_score, confidence_score, category, status, routing_suppressed_reason, ingested_at, enriched_at, routed_at, source_count, primary_source, enrichment_error"),
        supabase.from("signal_routing_feedback").select("signal_id, feedback, created_at"),
        supabase.from("decision_outcome_log").select("id, signal_id, action_taken, outcome_success, execution_status").not("signal_id", "is", null),
        supabase.from("signal_coverage_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("signal_detection_benchmarks").select("id, detected, validation_status, detection_latency_minutes, event_title").order("created_at", { ascending: false }).limit(100),
        supabase.from("signal_source_registry").select("source_name, official_source, enabled, source_type").order("priority", { ascending: true }),
      ]);

      const runs = connectorRes.data || [];
      const signals = signalsRes.data || [];
      const feedback = feedbackRes.data || [];
      const decisions = decisionsRes.data || [];
      const latestCoverage = coverageRes.data || null;
      const benchmarks = benchmarksRes.data || [];
      const registry = registryRes.data || [];

      const successRuns = runs.filter(r => r.run_status === "success").length;
      const intakeSuccessRate = runs.length > 0 ? Math.round(successRuns / runs.length * 100) : 0;
      const avgDuration = runs.length > 0 ? Math.round(runs.reduce((s, r) => s + (r.duration_ms || 0), 0) / runs.length) : 0;
      const pending = signals.filter(s => s.enrichment_status === "pending_enrichment").length;
      const stuck = signals.filter(s => s.enrichment_status === "enriching").length;
      const enriched = signals.filter(s => s.enrichment_status === "enriched").length;
      const withErrors = signals.filter(s => s.enrichment_error).length;
      const enrichSuccessRate = signals.length > 0 ? Math.round(enriched / signals.length * 100) : 0;

      const tier1 = signals.filter(s => s.source_trust_tier === "tier_1").length;
      const tier2 = signals.filter(s => s.source_trust_tier === "tier_2").length;
      const tier3 = signals.filter(s => s.source_trust_tier === "tier_3").length;
      const official = signals.filter(s => s.official_source_present).length;
      const tier12pct = signals.length > 0 ? Math.round((tier1 + tier2) / signals.length * 100) : 0;
      const officialPct = signals.length > 0 ? Math.round(official / signals.length * 100) : 0;
      const uniqueSources = new Set(signals.map(s => s.primary_source)).size;

      const multiConfirmed = signals.filter(s => s.multi_source_confirmed).length;
      const avgSourceCount = signals.length > 0 ? (signals.reduce((s, sig) => s + (sig.source_count || 1), 0) / signals.length).toFixed(1) : "0";

      const routed = signals.filter(s => s.routed_at).length;
      const suppressed = signals.filter(s => s.routing_suppressed_reason).length;
      const confirmed = feedback.filter(f => f.feedback === "confirmed").length;
      const rejected = feedback.filter(f => f.feedback === "rejected").length;
      const unclear = feedback.filter(f => f.feedback === "unclear").length;
      const feedbackTotal = feedback.length;
      const confirmRate = feedbackTotal > 0 ? Math.round(confirmed / feedbackTotal * 100) : 0;
      const rejectRate = feedbackTotal > 0 ? Math.round(rejected / feedbackTotal * 100) : 0;

      const signalDecisions = decisions.length;
      const accepted = decisions.filter(d => d.action_taken).length;
      const completed = decisions.filter(d => d.execution_status === "completed").length;
      const withOutcomes = decisions.filter(d => d.outcome_success !== null).length;

      const catCounts: Record<string, number> = {};
      for (const s of signals) catCounts[s.category] = (catCounts[s.category] || 0) + 1;

      const enrichTimes: number[] = [];
      for (const s of signals) {
        if (s.ingested_at && s.enriched_at) {
          const diff = new Date(s.enriched_at).getTime() - new Date(s.ingested_at).getTime();
          if (diff > 0) enrichTimes.push(diff / 1000);
        }
      }
      const avgEnrichSecs = enrichTimes.length > 0 ? Math.round(enrichTimes.reduce((a, b) => a + b, 0) / enrichTimes.length) : 0;

      const benchmarkDetected = benchmarks.filter(b => b.detected || b.validation_status === "detected").length;
      const benchmarkMissed = benchmarks.filter(b => b.validation_status === "missed").length;
      const benchmarkLatencies = benchmarks.map(b => b.detection_latency_minutes).filter((v): v is number => typeof v === "number");
      const avgBenchmarkLatency = benchmarkLatencies.length > 0 ? Math.round(benchmarkLatencies.reduce((a, b) => a + b, 0) / benchmarkLatencies.length) : 0;

      return {
        pipeline: { intakeSuccessRate, avgDuration, enrichSuccessRate, pending, stuck, withErrors, avgEnrichSecs, totalRuns: runs.length },
        sourceQuality: {
          tier1, tier2, tier3, official, tier12pct, officialPct, uniqueSources, total: signals.length,
          registryTotal: registry.length,
          registryOfficial: registry.filter(r => r.official_source).length,
          registryEnabled: registry.filter(r => r.enabled).length,
        },
        eventQuality: { multiConfirmed, avgSourceCount, total: signals.length },
        routing: { routed, suppressed, confirmed, rejected, unclear, feedbackTotal, confirmRate, rejectRate },
        decisions: { signalDecisions, accepted, completed, withOutcomes },
        coverage: {
          latest: latestCoverage,
          benchmarkTotal: benchmarks.length,
          benchmarkDetected,
          benchmarkMissed,
          avgBenchmarkLatency,
        },
        categories: catCounts,
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

function ScorecardSection({ title, icon: Icon, metrics }: { title: string; icon: any; metrics: ScorecardMetric[] }) {
  const passCount = metrics.filter(m => m.status === "pass").length;
  const failCount = metrics.filter(m => m.status === "fail").length;
  
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        </h3>
        <div className="flex gap-1">
          {passCount > 0 && <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/30 text-emerald-400">{passCount} pass</Badge>}
          {failCount > 0 && <Badge variant="outline" className="text-[9px] h-4 border-red-500/30 text-red-400">{failCount} fail</Badge>}
        </div>
      </div>
      <div className="divide-y divide-border/30">
        {metrics.map((m, i) => <MetricRow key={i} metric={m} />)}
      </div>
    </Card>
  );
}

export default function SignalValidation() {
  const { data, isLoading, refetch } = usePipelineMetrics();

  if (isLoading || !data) {
    return (
      <AICISLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AICISLayout>
    );
  }

  const { pipeline, sourceQuality, eventQuality, routing, decisions } = data;

  // Compute overall grade
  const scores: MetricStatus[] = [];
  const pipelineMetrics: ScorecardMetric[] = [
    { label: "Intake success rate", value: `${pipeline.intakeSuccessRate}%`, target: "≥ 98%", status: pipeline.intakeSuccessRate >= 98 ? "pass" : pipeline.intakeSuccessRate >= 90 ? "warn" : "fail" },
    { label: "Avg intake duration", value: `${(pipeline.avgDuration / 1000).toFixed(1)}s`, target: "< 3s", status: pipeline.avgDuration < 3000 ? "pass" : pipeline.avgDuration < 8000 ? "warn" : "fail" },
    { label: "Enrichment success rate", value: `${pipeline.enrichSuccessRate}%`, target: "≥ 90%", status: pipeline.enrichSuccessRate >= 90 ? "pass" : pipeline.enrichSuccessRate >= 70 ? "warn" : "fail" },
    { label: "Avg enrichment time", value: `${pipeline.avgEnrichSecs}s`, target: "< 30s", status: pipeline.avgEnrichSecs < 30 ? "pass" : pipeline.avgEnrichSecs < 120 ? "warn" : "fail" },
    { label: "Pending enrichment", value: pipeline.pending, target: "0", status: pipeline.pending === 0 ? "pass" : pipeline.pending < 5 ? "warn" : "fail" },
    { label: "Stuck enriching", value: pipeline.stuck, target: "0", status: pipeline.stuck === 0 ? "pass" : "fail" },
    { label: "Enrichment errors", value: pipeline.withErrors, target: "0", status: pipeline.withErrors === 0 ? "pass" : pipeline.withErrors < 3 ? "warn" : "fail" },
  ];
  pipelineMetrics.forEach(m => scores.push(m.status));

  const sourceMetrics: ScorecardMetric[] = [
    { label: "Total signals", value: sourceQuality.total, target: "rising", status: sourceQuality.total > 50 ? "pass" : sourceQuality.total > 10 ? "warn" : "fail" },
    { label: "Tier 1 count", value: sourceQuality.tier1, target: "rising", status: sourceQuality.tier1 > 20 ? "pass" : sourceQuality.tier1 > 5 ? "warn" : "fail" },
    { label: "Tier 2 count", value: sourceQuality.tier2, target: "rising", status: sourceQuality.tier2 > 10 ? "pass" : sourceQuality.tier2 > 3 ? "warn" : "fail" },
    { label: "Tier 3 count", value: sourceQuality.tier3, target: "declining", status: sourceQuality.tier3 < sourceQuality.total * 0.5 ? "pass" : sourceQuality.tier3 < sourceQuality.total * 0.7 ? "warn" : "fail" },
    { label: "Tier 1+2 share", value: `${sourceQuality.tier12pct}%`, target: "≥ 30%", status: sourceQuality.tier12pct >= 30 ? "pass" : sourceQuality.tier12pct >= 15 ? "warn" : "fail" },
    { label: "Official-source %", value: `${sourceQuality.officialPct}%`, target: "≥ 15%", status: sourceQuality.officialPct >= 15 ? "pass" : sourceQuality.officialPct >= 5 ? "warn" : "fail" },
    { label: "Unique sources", value: sourceQuality.uniqueSources, target: "≥ 15", status: sourceQuality.uniqueSources >= 15 ? "pass" : sourceQuality.uniqueSources >= 8 ? "warn" : "fail" },
  ];
  sourceMetrics.forEach(m => scores.push(m.status));

  const eventMetrics: ScorecardMetric[] = [
    { label: "Multi-source confirmed", value: eventQuality.multiConfirmed, target: "rising", status: eventQuality.multiConfirmed > 5 ? "pass" : eventQuality.multiConfirmed > 0 ? "warn" : "fail" },
    { label: "Avg source count", value: eventQuality.avgSourceCount, target: "> 1.0", status: parseFloat(eventQuality.avgSourceCount) > 1.0 ? "pass" : "warn" },
  ];
  eventMetrics.forEach(m => scores.push(m.status));

  const routingMetrics: ScorecardMetric[] = [
    { label: "Total routed", value: routing.routed, target: "rising", status: routing.routed > 10 ? "pass" : routing.routed > 0 ? "warn" : "fail" },
    { label: "Suppressed", value: routing.suppressed, target: "meaningful", status: routing.suppressed > 0 ? "pass" : "no_data" },
    { label: "Feedback collected", value: routing.feedbackTotal, target: "> 10", status: routing.feedbackTotal >= 10 ? "pass" : routing.feedbackTotal > 0 ? "warn" : "fail" },
    { label: "Confirm rate", value: routing.feedbackTotal > 0 ? `${routing.confirmRate}%` : "—", target: "≥ 70%", status: routing.feedbackTotal === 0 ? "no_data" : routing.confirmRate >= 70 ? "pass" : routing.confirmRate >= 50 ? "warn" : "fail" },
    { label: "Reject rate", value: routing.feedbackTotal > 0 ? `${routing.rejectRate}%` : "—", target: "< 20%", status: routing.feedbackTotal === 0 ? "no_data" : routing.rejectRate <= 20 ? "pass" : routing.rejectRate <= 35 ? "warn" : "fail" },
  ];
  routingMetrics.forEach(m => scores.push(m.status));

  const decisionMetrics: ScorecardMetric[] = [
    { label: "Signal → decisions", value: decisions.signalDecisions, target: "> 0", status: decisions.signalDecisions > 0 ? "pass" : "fail" },
    { label: "Accepted (action taken)", value: decisions.accepted, target: "rising", status: decisions.accepted > 0 ? "pass" : decisions.signalDecisions > 0 ? "warn" : "no_data" },
    { label: "Completed", value: decisions.completed, target: "> 0", status: decisions.completed > 0 ? "pass" : "warn" },
    { label: "Measured outcomes", value: decisions.withOutcomes, target: "> 0", status: decisions.withOutcomes > 0 ? "pass" : "warn" },
  ];
  decisionMetrics.forEach(m => scores.push(m.status));

  const passCount = scores.filter(s => s === "pass").length;
  const failCount = scores.filter(s => s === "fail").length;
  const warnCount = scores.filter(s => s === "warn").length;
  const overallGrade = failCount >= 5 ? "UNSTABLE" : failCount >= 3 ? "TECHNICALLY PROMISING" : failCount >= 1 ? "PILOT-READY" : "COMMERCIALLY DEFENSIBLE";
  const gradeColor = failCount >= 5 ? "text-red-400" : failCount >= 3 ? "text-amber-400" : failCount >= 1 ? "text-yellow-400" : "text-emerald-400";

  // Forensic findings
  const findings: { severity: "critical" | "medium" | "low"; text: string }[] = [];
  if (sourceQuality.tier3 > sourceQuality.total * 0.7) findings.push({ severity: "critical", text: `Tier 3 sources dominate at ${Math.round(sourceQuality.tier3 / sourceQuality.total * 100)}% — weak source mix` });
  if (sourceQuality.officialPct < 5) findings.push({ severity: "critical", text: `Official sources at ${sourceQuality.officialPct}% — below 15% target` });
  if (pipeline.avgEnrichSecs > 120) findings.push({ severity: "medium", text: `Avg enrichment ${pipeline.avgEnrichSecs}s — well above 30s target` });
  if (routing.feedbackTotal === 0) findings.push({ severity: "critical", text: "Zero routing feedback — precision metrics are blind" });
  if (eventQuality.multiConfirmed <= 1) findings.push({ severity: "medium", text: `Only ${eventQuality.multiConfirmed} multi-source confirmed signals — weak verification` });
  if (decisions.completed === 0) findings.push({ severity: "medium", text: "Zero completed signal-driven decisions" });
  if (decisions.withOutcomes === 0) findings.push({ severity: "medium", text: "Zero measured outcomes from signal-driven decisions" });
  if (pipeline.stuck > 0) findings.push({ severity: "critical", text: `${pipeline.stuck} signals stuck in 'enriching' state` });

  return (
    <AICISLayout>
      <ScrollArea className="h-full">
        <div className="p-4 max-w-4xl mx-auto space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Phase 16.2 Validation Scorecard
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Forensic audit of signal engine quality, routing precision, and commercial readiness
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>

          {/* Overall Grade */}
          <Card className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Overall Readiness</div>
              <div className={cn("text-xl font-bold font-mono", gradeColor)}>{overallGrade}</div>
            </div>
            <div className="flex gap-4 text-center">
              <div>
                <div className="text-lg font-bold font-mono text-emerald-400">{passCount}</div>
                <div className="text-[9px] text-muted-foreground">Pass</div>
              </div>
              <div>
                <div className="text-lg font-bold font-mono text-amber-400">{warnCount}</div>
                <div className="text-[9px] text-muted-foreground">Warn</div>
              </div>
              <div>
                <div className="text-lg font-bold font-mono text-red-400">{failCount}</div>
                <div className="text-[9px] text-muted-foreground">Fail</div>
              </div>
            </div>
          </Card>

          {/* Forensic Findings */}
          {findings.length > 0 && (
            <Card className="p-3">
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Forensic Findings ({findings.length})
              </h3>
              <div className="space-y-1">
                {findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs py-1">
                    <Badge variant="outline" className={cn(
                      "text-[9px] h-4 shrink-0",
                      f.severity === "critical" ? "border-red-500/30 text-red-400" :
                      f.severity === "medium" ? "border-amber-500/30 text-amber-400" :
                      "border-muted-foreground/30 text-muted-foreground"
                    )}>{f.severity}</Badge>
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Scorecard Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ScorecardSection title="Pipeline Reliability" icon={Activity} metrics={pipelineMetrics} />
            <ScorecardSection title="Source Quality" icon={Shield} metrics={sourceMetrics} />
            <ScorecardSection title="Event Quality / Dedup" icon={Globe} metrics={eventMetrics} />
            <ScorecardSection title="Routing Precision" icon={Radio} metrics={routingMetrics} />
          </div>

          <ScorecardSection title="Decision Usefulness" icon={TrendingUp} metrics={decisionMetrics} />

          {/* Category Breakdown */}
          <Card className="p-3">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" /> Category Distribution
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {Object.entries(data.categories)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => (
                  <div key={cat} className="text-center p-1.5 rounded bg-muted/30">
                    <div className="text-sm font-bold font-mono">{count}</div>
                    <div className="text-[9px] text-muted-foreground truncate">{cat.replace("_", " ")}</div>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      </ScrollArea>
    </AICISLayout>
  );
}