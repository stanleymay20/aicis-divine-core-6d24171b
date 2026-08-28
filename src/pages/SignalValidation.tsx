import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, AlertTriangle, Database, TrendingUp, Shield, Radio, Globe,
  Loader2, RefreshCw, BarChart3,
} from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";

const GOVERNED_SIGNAL_SCORE_SEMANTICS =
  "deterministic_source_registry_trust_and_source_event_recency_screen_v1_not_probability_source_independence_excluded";

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
      <span className="text-xs flex-1 truncate" title={metric.detail}>{metric.label}</span>
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
        supabase.from("global_signals").select(
          "id,enrichment_status,source_trust_tier,official_source_present,impact_score,confidence_score,category,status,routing_suppressed_reason,ingested_at,enriched_at,routed_at,primary_source,enrichment_error,multi_source_confirmed",
        ),
        supabase.from("signal_routing_feedback").select("signal_id,feedback,created_at"),
        supabase.from("decision_outcome_log").select("id,signal_id,action_taken,outcome_success,execution_status").not("signal_id", "is", null),
        supabase.from("signal_coverage_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("signal_detection_benchmarks").select("id,detected,validation_status,detection_latency_minutes,event_title").order("created_at", { ascending: false }).limit(100),
        supabase.from("signal_source_registry").select("source_name,official_source,enabled,source_type").order("priority", { ascending: true }),
      ]);

      const runs = connectorRes.data || [];
      // Provenance-governance columns are not yet provisioned on global_signals; they read as
      // absent (undefined) so dependent metrics honestly report "no data" instead of fabricating.
      const signals = (signalsRes.data || []) as unknown as Array<
        NonNullable<typeof signalsRes.data>[number] & {
          confidence_score_semantics?: string | null;
          source_identifier_count?: number | null;
          source_independence_status?: string | null;
          independent_origin_count?: number | null;
        }
      >;

      const feedback = feedbackRes.data || [];
      const decisions = decisionsRes.data || [];
      const latestCoverage = coverageRes.data || null;
      const benchmarks = benchmarksRes.data || [];
      const registry = registryRes.data || [];

      const successRuns = runs.filter((row) => row.run_status === "success").length;
      const intakeSuccessRate = runs.length > 0 ? Math.round(successRuns / runs.length * 100) : 0;
      const avgDuration = runs.length > 0
        ? Math.round(runs.reduce((sum, row) => sum + (row.duration_ms || 0), 0) / runs.length)
        : 0;
      const pending = signals.filter((row) => row.enrichment_status === "pending_enrichment").length;
      const stuck = signals.filter((row) => row.enrichment_status === "enriching").length;
      const enriched = signals.filter((row) => row.enrichment_status === "enriched").length;
      const withErrors = signals.filter((row) => row.enrichment_error).length;
      const enrichSuccessRate = signals.length > 0 ? Math.round(enriched / signals.length * 100) : 0;

      const tier1 = signals.filter((row) => row.source_trust_tier === "tier_1").length;
      const tier2 = signals.filter((row) => row.source_trust_tier === "tier_2").length;
      const tier3 = signals.filter((row) => row.source_trust_tier === "tier_3").length;
      const official = signals.filter((row) => row.official_source_present).length;
      const tier12pct = signals.length > 0 ? Math.round((tier1 + tier2) / signals.length * 100) : 0;
      const officialPct = signals.length > 0 ? Math.round(official / signals.length * 100) : 0;
      const uniqueSources = new Set(
        signals
          .map((row) => typeof row.primary_source === "string" ? row.primary_source.trim() : "")
          .filter(Boolean),
      ).size;

      const independentlyCorroborated = signals.filter((row) =>
        row.source_independence_status === "established" &&
        typeof row.independent_origin_count === "number" &&
        row.independent_origin_count >= 2 &&
        row.multi_source_confirmed === true
      ).length;
      const completeLineage = signals.filter((row) =>
        row.source_independence_status === "established" ||
        row.source_independence_status === "complete_not_corroborated"
      ).length;
      const partialLineage = signals.filter((row) => row.source_independence_status === "partial").length;
      const conflictedLineage = signals.filter((row) => row.source_independence_status === "conflicted").length;
      const lineageCompletePct = signals.length > 0 ? Math.round(completeLineage / signals.length * 100) : 0;
      const governedSignalScores = signals.filter((row) =>
        row.confidence_score != null &&
        row.confidence_score_semantics === GOVERNED_SIGNAL_SCORE_SEMANTICS
      ).length;
      const governedSignalScorePct = signals.length > 0
        ? Math.round(governedSignalScores / signals.length * 100)
        : 0;

      const sourceIdentifierValues = signals
        .map((row) => row.source_identifier_count)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const avgSourceIdentifiers = sourceIdentifierValues.length > 0
        ? (sourceIdentifierValues.reduce((sum, value) => sum + value, 0) / sourceIdentifierValues.length).toFixed(1)
        : null;

      const routed = signals.filter((row) => row.routed_at).length;
      const suppressed = signals.filter((row) => row.routing_suppressed_reason).length;
      const confirmed = feedback.filter((row) => row.feedback === "confirmed").length;
      const rejected = feedback.filter((row) => row.feedback === "rejected").length;
      const unclear = feedback.filter((row) => row.feedback === "unclear").length;
      const feedbackTotal = feedback.length;
      const confirmRate = feedbackTotal > 0 ? Math.round(confirmed / feedbackTotal * 100) : 0;
      const rejectRate = feedbackTotal > 0 ? Math.round(rejected / feedbackTotal * 100) : 0;

      const signalDecisions = decisions.length;
      const accepted = decisions.filter((row) => row.action_taken).length;
      const completed = decisions.filter((row) => row.execution_status === "completed").length;
      const withOutcomes = decisions.filter((row) => row.outcome_success !== null).length;

      const catCounts: Record<string, number> = {};
      for (const signal of signals) catCounts[signal.category] = (catCounts[signal.category] || 0) + 1;

      const enrichTimes: number[] = [];
      for (const signal of signals) {
        if (signal.ingested_at && signal.enriched_at) {
          const diff = new Date(signal.enriched_at).getTime() - new Date(signal.ingested_at).getTime();
          if (diff > 0) enrichTimes.push(diff / 1000);
        }
      }
      const avgEnrichSecs = enrichTimes.length > 0
        ? Math.round(enrichTimes.reduce((left, right) => left + right, 0) / enrichTimes.length)
        : 0;

      const benchmarkDetected = benchmarks.filter((row) => row.detected || row.validation_status === "detected").length;
      const benchmarkMissed = benchmarks.filter((row) => row.validation_status === "missed").length;
      const benchmarkLatencies = benchmarks
        .map((row) => row.detection_latency_minutes)
        .filter((value): value is number => typeof value === "number");
      const avgBenchmarkLatency = benchmarkLatencies.length > 0
        ? Math.round(benchmarkLatencies.reduce((left, right) => left + right, 0) / benchmarkLatencies.length)
        : 0;

      return {
        pipeline: {
          intakeSuccessRate,
          avgDuration,
          enrichSuccessRate,
          pending,
          stuck,
          withErrors,
          avgEnrichSecs,
          totalRuns: runs.length,
        },
        sourceQuality: {
          tier1,
          tier2,
          tier3,
          official,
          tier12pct,
          officialPct,
          uniqueSources,
          total: signals.length,
          registryTotal: registry.length,
          registryOfficial: registry.filter((row) => row.official_source).length,
          registryEnabled: registry.filter((row) => row.enabled).length,
        },
        eventQuality: {
          independentlyCorroborated,
          completeLineage,
          partialLineage,
          conflictedLineage,
          lineageCompletePct,
          governedSignalScores,
          governedSignalScorePct,
          avgSourceIdentifiers,
          sourceIdentifierObserved: sourceIdentifierValues.length,
          total: signals.length,
        },
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

function ScorecardSection({ title, icon: Icon, metrics }: { title: string; icon: typeof Activity; metrics: ScorecardMetric[] }) {
  const passCount = metrics.filter((metric) => metric.status === "pass").length;
  const failCount = metrics.filter((metric) => metric.status === "fail").length;

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
        {metrics.map((metric) => <MetricRow key={metric.label} metric={metric} />)}
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

  const { pipeline, sourceQuality, eventQuality, routing, decisions, coverage } = data;

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
  pipelineMetrics.forEach((metric) => scores.push(metric.status));

  const sourceMetrics: ScorecardMetric[] = [
    { label: "Tracked sources", value: sourceQuality.registryTotal, target: "≥ 15", status: sourceQuality.registryTotal >= 15 ? "pass" : sourceQuality.registryTotal >= 10 ? "warn" : "fail" },
    { label: "Official feeds", value: sourceQuality.registryOfficial, target: "≥ 8", status: sourceQuality.registryOfficial >= 8 ? "pass" : sourceQuality.registryOfficial >= 5 ? "warn" : "fail" },
    { label: "Live unique source IDs", value: sourceQuality.uniqueSources, target: "coverage", status: sourceQuality.uniqueSources > 0 ? "no_data" : "no_data", detail: "Descriptive publisher/source-identifier diversity only; it is not independent corroboration." },
    { label: "Tier 1+2 share", value: `${sourceQuality.tier12pct}%`, target: "≥ 30%", status: sourceQuality.tier12pct >= 30 ? "pass" : sourceQuality.tier12pct >= 15 ? "warn" : "fail" },
    { label: "Official-source %", value: `${sourceQuality.officialPct}%`, target: "≥ 15%", status: sourceQuality.officialPct >= 15 ? "pass" : sourceQuality.officialPct >= 5 ? "warn" : "fail" },
    { label: "Tier 3 count", value: sourceQuality.tier3, target: "declining", status: sourceQuality.tier3 < sourceQuality.total * 0.5 ? "pass" : sourceQuality.tier3 < sourceQuality.total * 0.7 ? "warn" : "fail" },
    { label: "Signals in window", value: sourceQuality.total, target: "coverage", status: "no_data", detail: "Volume is descriptive and does not itself establish quality." },
  ];
  sourceMetrics.forEach((metric) => scores.push(metric.status));

  const eventMetrics: ScorecardMetric[] = [
    {
      label: "Independent-origin corroborated",
      value: eventQuality.independentlyCorroborated,
      target: "rising",
      status: eventQuality.total === 0 ? "no_data" : eventQuality.independentlyCorroborated > 5 ? "pass" : eventQuality.independentlyCorroborated > 0 ? "warn" : "fail",
      detail: "Counts only signals with complete source lineage and at least two explicit independent origins.",
    },
    {
      label: "Complete source lineage",
      value: eventQuality.total > 0 ? `${eventQuality.lineageCompletePct}%` : "—",
      target: "≥ 80%",
      status: eventQuality.total === 0 ? "no_data" : eventQuality.lineageCompletePct >= 80 ? "pass" : eventQuality.lineageCompletePct >= 50 ? "warn" : "fail",
    },
    {
      label: "Governed signal screens",
      value: eventQuality.total > 0 ? `${eventQuality.governedSignalScorePct}%` : "—",
      target: "≥ 90%",
      status: eventQuality.total === 0 ? "no_data" : eventQuality.governedSignalScorePct >= 90 ? "pass" : eventQuality.governedSignalScorePct >= 60 ? "warn" : "fail",
      detail: "Only scores carrying the current deterministic non-probability semantics count.",
    },
    {
      label: "Avg source identifiers",
      value: eventQuality.avgSourceIdentifiers ?? "—",
      target: "descriptive",
      status: "no_data",
      detail: `Average over ${eventQuality.sourceIdentifierObserved} signals with an observed source-identifier count. Missing counts are excluded, never substituted with 1.`,
    },
    { label: "Benchmarks detected", value: `${coverage.benchmarkDetected}/${coverage.benchmarkTotal}`, target: "all", status: coverage.benchmarkTotal === 0 ? "no_data" : coverage.benchmarkDetected === coverage.benchmarkTotal ? "pass" : coverage.benchmarkDetected >= Math.ceil(coverage.benchmarkTotal * 0.7) ? "warn" : "fail" },
    { label: "Avg benchmark latency", value: coverage.benchmarkTotal > 0 ? `${coverage.avgBenchmarkLatency}m` : "—", target: "< 120m", status: coverage.benchmarkTotal === 0 ? "no_data" : coverage.avgBenchmarkLatency <= 120 ? "pass" : coverage.avgBenchmarkLatency <= 360 ? "warn" : "fail" },
  ];
  eventMetrics.forEach((metric) => scores.push(metric.status));

  const routingMetrics: ScorecardMetric[] = [
    { label: "Total routed", value: routing.routed, target: "rising", status: routing.routed > 10 ? "pass" : routing.routed > 0 ? "warn" : "fail" },
    { label: "Suppressed", value: routing.suppressed, target: "meaningful", status: routing.suppressed > 0 ? "pass" : "no_data" },
    { label: "Feedback collected", value: routing.feedbackTotal, target: "> 10", status: routing.feedbackTotal >= 10 ? "pass" : routing.feedbackTotal > 0 ? "warn" : "fail" },
    { label: "Confirm rate", value: routing.feedbackTotal > 0 ? `${routing.confirmRate}%` : "—", target: "≥ 70%", status: routing.feedbackTotal === 0 ? "no_data" : routing.confirmRate >= 70 ? "pass" : routing.confirmRate >= 50 ? "warn" : "fail" },
    { label: "Reject rate", value: routing.feedbackTotal > 0 ? `${routing.rejectRate}%` : "—", target: "< 20%", status: routing.feedbackTotal === 0 ? "no_data" : routing.rejectRate <= 20 ? "pass" : routing.rejectRate <= 35 ? "warn" : "fail" },
  ];
  routingMetrics.forEach((metric) => scores.push(metric.status));

  const decisionMetrics: ScorecardMetric[] = [
    { label: "Signal → decisions", value: decisions.signalDecisions, target: "> 0", status: decisions.signalDecisions > 0 ? "pass" : "fail" },
    { label: "Accepted (action taken)", value: decisions.accepted, target: "rising", status: decisions.accepted > 0 ? "pass" : decisions.signalDecisions > 0 ? "warn" : "no_data" },
    { label: "Completed", value: decisions.completed, target: "> 0", status: decisions.completed > 0 ? "pass" : "warn" },
    { label: "Measured outcomes", value: decisions.withOutcomes, target: "> 0", status: decisions.withOutcomes > 0 ? "pass" : "warn" },
  ];
  decisionMetrics.forEach((metric) => scores.push(metric.status));

  const passCount = scores.filter((status) => status === "pass").length;
  const failCount = scores.filter((status) => status === "fail").length;
  const warnCount = scores.filter((status) => status === "warn").length;
  const overallGrade = failCount >= 5
    ? "UNSTABLE"
    : failCount >= 3
      ? "TECHNICALLY PROMISING"
      : failCount >= 1
        ? "PILOT-READY"
        : "COMMERCIALLY DEFENSIBLE";
  const gradeColor = failCount >= 5
    ? "text-red-400"
    : failCount >= 3
      ? "text-amber-400"
      : failCount >= 1
        ? "text-yellow-400"
        : "text-emerald-400";

  const findings: { severity: "critical" | "medium" | "low"; text: string }[] = [];
  if (sourceQuality.tier3 > sourceQuality.total * 0.7) findings.push({ severity: "critical", text: `Tier 3 sources dominate at ${Math.round(sourceQuality.tier3 / Math.max(sourceQuality.total, 1) * 100)}% — weak source mix` });
  if (sourceQuality.officialPct < 5) findings.push({ severity: "critical", text: `Official sources at ${sourceQuality.officialPct}% — below 15% target` });
  if (sourceQuality.registryTotal < 15) findings.push({ severity: "critical", text: `Only ${sourceQuality.registryTotal} tracked intake sources — not yet planetary enough` });
  if (coverage.benchmarkMissed > 0) findings.push({ severity: "critical", text: `${coverage.benchmarkMissed} benchmark events were missed — planetary blind spots remain` });
  if (pipeline.avgEnrichSecs > 120) findings.push({ severity: "medium", text: `Avg enrichment ${pipeline.avgEnrichSecs}s — well above 30s target` });
  if (routing.feedbackTotal === 0) findings.push({ severity: "critical", text: "Zero routing feedback — precision metrics are blind" });
  if (eventQuality.total > 0 && eventQuality.lineageCompletePct < 50) findings.push({ severity: "critical", text: `Complete source lineage covers only ${eventQuality.lineageCompletePct}% of signals — independent corroboration remains largely unassessable` });
  if (eventQuality.independentlyCorroborated <= 1) findings.push({ severity: "medium", text: `Only ${eventQuality.independentlyCorroborated} signals have at least two explicitly independent origins` });
  if (eventQuality.partialLineage > 0) findings.push({ severity: "medium", text: `${eventQuality.partialLineage} signals have only partial source-lineage coverage` });
  if (eventQuality.conflictedLineage > 0) findings.push({ severity: "critical", text: `${eventQuality.conflictedLineage} signals have conflicting source-origin lineage` });
  if (eventQuality.total > 0 && eventQuality.governedSignalScorePct < 60) findings.push({ severity: "medium", text: `Only ${eventQuality.governedSignalScorePct}% of signals carry the current governed evidence-screen semantics` });
  if (decisions.completed === 0) findings.push({ severity: "medium", text: "Zero completed signal-driven decisions" });
  if (decisions.withOutcomes === 0) findings.push({ severity: "medium", text: "Zero measured outcomes from signal-driven decisions" });
  if (pipeline.stuck > 0) findings.push({ severity: "critical", text: `${pipeline.stuck} signals stuck in 'enriching' state` });

  return (
    <AICISLayout>
      <ScrollArea className="h-full">
        <div className="p-4 max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Signal Validation Scorecard
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Forensic audit of pipeline reliability, explicit source lineage, routing precision, and decision usefulness
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>

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

          {findings.length > 0 ? (
            <Card className="p-3">
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Forensic Findings ({findings.length})
              </h3>
              <div className="space-y-1">
                {findings.map((finding, index) => (
                  <div key={`${finding.text}-${index}`} className="flex items-start gap-2 text-xs py-1">
                    <Badge variant="outline" className={cn(
                      "text-[9px] h-4 shrink-0",
                      finding.severity === "critical" ? "border-red-500/30 text-red-400" :
                      finding.severity === "medium" ? "border-amber-500/30 text-amber-400" :
                      "border-muted-foreground/30 text-muted-foreground",
                    )}>{finding.severity}</Badge>
                    <span>{finding.text}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <PanelEmpty
              title="No forensic findings"
              reason="Every scored metric is at or above its operator threshold; descriptive source-volume metrics do not contribute to this grade."
              nextStep="No action required. Findings reappear automatically if a scored metric regresses."
              compact
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ScorecardSection title="Pipeline Reliability" icon={Activity} metrics={pipelineMetrics} />
            <ScorecardSection title="Source Quality" icon={Shield} metrics={sourceMetrics} />
            <ScorecardSection title="Event Evidence / Identity" icon={Globe} metrics={eventMetrics} />
            <ScorecardSection title="Routing Precision" icon={Radio} metrics={routingMetrics} />
          </div>

          <ScorecardSection title="Decision Usefulness" icon={TrendingUp} metrics={decisionMetrics} />

          <Card className="p-3">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" /> Category Distribution
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {Object.entries(data.categories)
                .sort((left, right) => right[1] - left[1])
                .map(([category, count]) => (
                  <div key={category} className="text-center p-1.5 rounded bg-muted/30">
                    <div className="text-sm font-bold font-mono">{count}</div>
                    <div className="text-[9px] text-muted-foreground truncate">{category.replace("_", " ")}</div>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      </ScrollArea>
    </AICISLayout>
  );
}