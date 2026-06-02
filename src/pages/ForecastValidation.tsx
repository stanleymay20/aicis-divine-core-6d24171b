import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertTriangle, Clock, Target, CheckCircle2, FlaskConical, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { useForecastValidation, runLifecycleTest, takeSnapshot } from "@/components/forecast-validation/queries";
import { SummaryCard, MetricCard, statusColor } from "@/components/forecast-validation/atoms";
import { AccumulationMonitor } from "@/components/forecast-validation/AccumulationMonitor";
import { MatchPolicyCoverage } from "@/components/forecast-validation/MatchPolicyCoverage";
import { MatchQualityAudit } from "@/components/forecast-validation/MatchQualityAudit";
import { PromotionReadiness, CoverageGaps } from "@/components/forecast-validation/ReadinessAndGaps";
import { BreakdownTables } from "@/components/forecast-validation/BreakdownTables";

export default function ForecastValidation() {
  const { data, isLoading } = useForecastValidation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [testRunning, setTestRunning] = useState(false);

  const stats = data?.stats ?? null;
  const readiness = data?.readiness ?? null;
  const health = data?.health ?? null;
  const accumulation = data?.accumulation ?? null;

  const sampleStatus = !stats ? "AWAITING_DATA" : stats.locked === 0 ? "AWAITING_DATA" : stats.locked < 30 ? "INSUFFICIENT_SAMPLE" : stats.locked < 50 ? "EMERGING" : readiness?.ready ? "DECISION_GRADE" : "EVALUABLE";

  async function handleLifecycleTest() {
    setTestRunning(true);
    try {
      const res = await runLifecycleTest();
      if (res.ok) {
        toast({ title: "Lifecycle Test Passed ✓", description: `Inserted → Realized → Locked in ${res.duration_ms}ms` });
        qc.invalidateQueries({ queryKey: ["forecast-validation"] });
      } else {
        toast({ title: "Lifecycle Test Failed", description: res.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Test Error", description: (e as Error).message, variant: "destructive" });
    } finally { setTestRunning(false); }
  }

  async function handleSnapshot() {
    const { error } = await takeSnapshot();
    if (error) toast({ title: "Snapshot failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Snapshot saved" }); qc.invalidateQueries({ queryKey: ["forecast-validation"] }); }
  }

  if (isLoading) return <div className="flex items-center justify-center min-h-screen bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Prospective Forecast Validation</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">Clean, forward-looking forecast evaluation. No historical backfills or edits are included.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSnapshot}><Activity className="h-3 w-3 mr-1" />Snapshot</Button>
          <Button variant="outline" size="sm" onClick={handleLifecycleTest} disabled={testRunning}>
            {testRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FlaskConical className="h-3 w-3 mr-1" />}Lifecycle Test
          </Button>
        </div>
      </div>

      {health && !health.ok && (
        <div className="space-y-2">
          {health.alerts.map((alert, i) => (
            <div key={i} className={`rounded-lg px-4 py-2 flex items-center gap-2 text-xs ${alert.severity === "critical" ? "bg-destructive/20 text-destructive" : "bg-yellow-500/20 text-yellow-400"}`}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${statusColor[sampleStatus]}`}>
        {sampleStatus === "DECISION_GRADE" ? <ShieldCheck className="h-5 w-5" /> : sampleStatus === "AWAITING_DATA" ? <Clock className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        <div>
          <span className="font-semibold text-sm">{sampleStatus.replace(/_/g, " ")}</span>
          <span className="text-xs ml-2 opacity-80">
            {sampleStatus === "AWAITING_DATA" && "Prospective forecasts are accumulating. Evaluation begins after realization."}
            {sampleStatus === "INSUFFICIENT_SAMPLE" && `${stats?.locked ?? 0} realized — need 30+ for scoring.`}
            {sampleStatus === "EMERGING" && `${stats?.locked ?? 0} realized — approaching statistical significance.`}
            {sampleStatus === "EVALUABLE" && `${stats?.locked ?? 0} realized — score active but not yet decision-grade.`}
            {sampleStatus === "DECISION_GRADE" && "Forecasts meet all decision-grade criteria."}
          </span>
        </div>
      </div>

      <PanelBoundary><AccumulationMonitor accumulation={accumulation} /></PanelBoundary>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={<Target className="h-4 w-4" />} label="Total Forecasts" value={stats?.total ?? 0} />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Awaiting Realization" value={stats?.pending ?? 0} />
        <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Realized (Locked)" value={stats?.locked ?? 0} />
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="Sample Status"
          value={(stats?.locked ?? 0) < 30 ? "Insufficient" : (stats?.locked ?? 0) < 100 ? "Emerging" : "Meaningful"}
          valueClass={(stats?.locked ?? 0) >= 100 ? "text-emerald-400" : (stats?.locked ?? 0) >= 30 ? "text-blue-400" : "text-yellow-400"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Turning Point Accuracy" value={`${stats?.tp_accuracy ?? 0}%`} sub={`${stats?.tp_hits ?? 0}/${stats?.tp_total ?? 0} hits`} />
        <MetricCard label="Average MAE" value={stats?.avg_mae?.toFixed(2) ?? "—"} sub="Mean absolute error" />
        <MetricCard label="Direction Hit Rate" value={`${stats?.direction_hit_rate ?? 0}%`} sub="All directions" />
        <MetricCard label="Coverage" value={`${stats?.domain_count ?? 0}D / ${stats?.country_count ?? 0}C`} sub="Domains / Countries" />
      </div>

      <PanelBoundary><MatchPolicyCoverage policies={data?.policies ?? []} domains={data?.domains ?? []} matchQuality={data?.matchQuality} /></PanelBoundary>
      <PanelBoundary><MatchQualityAudit matchQuality={data?.matchQuality} /></PanelBoundary>
      <PanelBoundary><PromotionReadiness readiness={readiness} /></PanelBoundary>
      <PanelBoundary><CoverageGaps coverageGaps={data?.coverageGaps} /></PanelBoundary>
      <PanelBoundary><BreakdownTables domains={data?.domains ?? []} horizons={data?.horizons ?? []} models={data?.models ?? []} snapshots={data?.snapshots ?? []} /></PanelBoundary>

      <div className="border border-border rounded-lg p-4 bg-muted/30">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Prospective Forecast Score</strong> is based{" "}
          <strong>ONLY</strong> on forward-looking predictions. No historical backfills or edits
          are included. Evaluations are immutably locked upon realization and cannot be modified.
          This score is the only metric suitable for external claims about forecast accuracy.
        </p>
      </div>
    </div>
  );
}
