import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Activity, CheckCircle, XCircle, Clock, Server, Database, Zap, AlertTriangle, Radio, Shield, TrendingUp, BarChart3, Layers } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface PipelineStatus {
  name: string;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  lastRun: string | null;
  lastStatus: string;
  successRate: number;
}

const SystemStatus = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const { data, isLoading } = useQuery({
    queryKey: ["system-status-enterprise"],
    queryFn: async () => {
      const [logsRes, snapshotRes, divisionsRes, validationsRes, truthRes, accumRes] = await Promise.all([
        supabase.from("automation_logs").select("job_name, status, executed_at").order("executed_at", { ascending: false }).limit(1000),
        supabase.from("country_performance_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
        supabase.from("ai_divisions").select("name, status, last_check, uptime_percentage"),
        supabase.from("forecast_validation_results").select("id", { count: "exact", head: true }),
        // Truth validation scores
        supabase.from("signal_truth_scores").select("*").eq("signal_type", "system_audit").order("created_at", { ascending: false }).limit(5),
        // Quality audits
        supabase.from("data_quality_audits").select("*").order("created_at", { ascending: false }).limit(20),
      ]);

      // Aggregate pipeline stats
      const logs = logsRes.data || [];
      const pipelineMap = new Map<string, { total: number; success: number; error: number; lastRun: string | null; lastStatus: string }>();

      for (const log of logs) {
        if (log.status === "running" || log.status === "timeout") continue;
        const existing = pipelineMap.get(log.job_name) || { total: 0, success: 0, error: 0, lastRun: null, lastStatus: "unknown" };
        existing.total++;
        if (log.status === "success") existing.success++;
        if (log.status === "error") existing.error++;
        if (!existing.lastRun || log.executed_at > existing.lastRun) {
          existing.lastRun = log.executed_at;
          existing.lastStatus = log.status;
        }
        pipelineMap.set(log.job_name, existing);
      }

      const pipelines: PipelineStatus[] = Array.from(pipelineMap.entries())
        .map(([name, s]) => ({
          name,
          totalRuns: s.total,
          successRuns: s.success,
          errorRuns: s.error,
          lastRun: s.lastRun,
          lastStatus: s.lastStatus,
          successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
        }))
        .sort((a, b) => {
          if (a.lastStatus === "error" && b.lastStatus !== "error") return -1;
          if (b.lastStatus === "error" && a.lastStatus !== "error") return 1;
          return a.name.localeCompare(b.name);
        });

      const totalSuccess = pipelines.reduce((s, p) => s + p.successRuns, 0);
      const totalRuns = pipelines.reduce((s, p) => s + p.totalRuns, 0);
      const overallRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0;

      const activePipelines = pipelines.filter(p => {
        if (!p.lastRun) return false;
        const daysSince = (Date.now() - new Date(p.lastRun).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince < 7;
      });

      const failingPipelines = activePipelines.filter(p => p.lastStatus === "error");

      // Parse truth scores
      const truthScores = (truthRes.data || []).map((t: any) => ({
        score: t.overall_truth_score,
        grade: t.evidence?.grade,
        audits: t.evidence?.audits,
        allPassed: t.evidence?.all_passed,
        durationMs: t.evidence?.duration_ms,
        createdAt: t.created_at,
      }));

      // Parse quality audits by layer
      const qualityByLayer: Record<string, any> = {};
      for (const audit of (accumRes.data || [])) {
        if (!qualityByLayer[audit.layer]) {
          qualityByLayer[audit.layer] = audit;
        }
      }

      return {
        pipelines,
        activePipelines: activePipelines.length,
        failingPipelines: failingPipelines.length,
        overallRate,
        lastSnapshot: snapshotRes.data?.[0]?.snapshot_date || null,
        divisions: divisionsRes.data || [],
        totalValidations: validationsRes.count || 0,
        truthScores,
        qualityByLayer,
      };
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  if (authLoading || !user) return null;

  const overallHealth = data
    ? data.failingPipelines === 0 ? "operational" : data.failingPipelines <= 2 ? "degraded" : "outage"
    : "unknown";

  const latestTruth = data?.truthScores?.[0];

  return (
    <AICISLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-orbitron font-bold text-foreground flex items-center gap-3">
              <Server className="h-7 w-7 text-primary" />
              System Status
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Operational health & data truth validation — updated every 60s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Radio className="h-3 w-3 text-destructive animate-pulse" />
            <span className="text-xs text-muted-foreground">LIVE</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data ? (
          <>
            {/* Overall Status Banner */}
            <Card className={`border-2 ${
              overallHealth === "operational" ? "border-success/50 bg-success/5" :
              overallHealth === "degraded" ? "border-warning/50 bg-warning/5" :
              "border-destructive/50 bg-destructive/5"
            }`}>
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {overallHealth === "operational" ? (
                    <CheckCircle className="h-8 w-8 text-success" />
                  ) : overallHealth === "degraded" ? (
                    <AlertTriangle className="h-8 w-8 text-warning" />
                  ) : (
                    <XCircle className="h-8 w-8 text-destructive" />
                  )}
                  <div>
                    <p className="text-lg font-bold capitalize">{overallHealth === "operational" ? "All Systems Operational" : overallHealth === "degraded" ? "Partial Degradation" : "Service Disruption"}</p>
                    <p className="text-xs text-muted-foreground">
                      {data.activePipelines} active pipelines · {data.failingPipelines} failing · {data.overallRate}% overall success rate
                    </p>
                  </div>
                </div>
                <Badge variant={overallHealth === "operational" ? "default" : "destructive"} className="text-xs">
                  {data.overallRate}% uptime
                </Badge>
              </CardContent>
            </Card>

            {/* ═══ TRUTH VALIDATION SCORE ═══ */}
            {latestTruth && (
              <Card className={`border-2 ${
                latestTruth.score >= 80 ? "border-success/50 bg-success/5" :
                latestTruth.score >= 60 ? "border-primary/50 bg-primary/5" :
                latestTruth.score >= 40 ? "border-warning/50 bg-warning/5" :
                "border-destructive/50 bg-destructive/5"
              }`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Data Truth Score
                    <Badge variant="outline" className="ml-auto text-[9px]">
                      {latestTruth.createdAt ? formatDistanceToNow(new Date(latestTruth.createdAt), { addSuffix: true }) : "—"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className={`text-4xl font-orbitron font-bold ${
                        latestTruth.score >= 80 ? "text-success" :
                        latestTruth.score >= 60 ? "text-primary" :
                        latestTruth.score >= 40 ? "text-warning" :
                        "text-destructive"
                      }`}>{latestTruth.score}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">/100</p>
                    </div>
                    <div className="flex-1">
                      <Badge className={`text-xs ${
                        latestTruth.grade === "ENTERPRISE" ? "bg-success/20 text-success" :
                        latestTruth.grade === "OPERATIONAL" ? "bg-primary/20 text-primary" :
                        latestTruth.grade === "DEVELOPING" ? "bg-warning/20 text-warning" :
                        "bg-destructive/20 text-destructive"
                      }`}>
                        {latestTruth.grade}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {latestTruth.allPassed ? "All validation checks passed" : "Some validation checks need attention"}
                      </p>
                    </div>
                  </div>

                  {/* Layer-by-layer breakdown */}
                  {latestTruth.audits && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { key: "entity_links", label: "Link Precision", icon: <Layers className="h-3.5 w-3.5" /> },
                        { key: "events", label: "Event Quality", icon: <Activity className="h-3.5 w-3.5" /> },
                        { key: "metrics", label: "Metric Coverage", icon: <BarChart3 className="h-3.5 w-3.5" /> },
                        { key: "forecasts", label: "Forecast Truth", icon: <TrendingUp className="h-3.5 w-3.5" /> },
                      ].map(({ key, label, icon }) => {
                        const audit = latestTruth.audits[key];
                        if (!audit) return null;
                        const score = key === "entity_links" ? audit.precision : audit.score;
                        return (
                          <div key={key} className={`p-3 rounded-lg border ${
                            audit.passed ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
                          }`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              {icon}
                              <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
                            </div>
                            <p className={`text-xl font-orbitron font-bold ${audit.passed ? "text-success" : "text-destructive"}`}>
                              {score}%
                            </p>
                            <p className="text-[9px] text-muted-foreground mt-0.5">
                              {audit.passed ? "✓ Passed" : "✗ Needs work"}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Intelligence grade from forecasts */}
                  {latestTruth.audits?.forecasts && (
                    <div className="text-xs text-muted-foreground flex items-center gap-4 pt-1 border-t border-border/30">
                      <span>Turning Point Accuracy: <strong className="text-foreground">{latestTruth.audits.forecasts.turning_point_accuracy}%</strong></span>
                      <span>MAE: <strong className="text-foreground">{latestTruth.audits.forecasts.avg_mae}</strong></span>
                      <Badge variant="outline" className="text-[9px]">{latestTruth.audits.forecasts.intelligence_grade}</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard icon={<Activity className="h-5 w-5 text-primary" />} label="Active Pipelines" value={data.activePipelines} />
              <MetricCard icon={<Database className="h-5 w-5 text-primary" />} label="Total Validations" value={data.totalValidations.toLocaleString()} />
              <MetricCard icon={<Clock className="h-5 w-5 text-primary" />} label="Last Snapshot" value={data.lastSnapshot ? format(new Date(data.lastSnapshot), "MMM d") : "—"} />
              <MetricCard icon={<Zap className="h-5 w-5 text-primary" />} label="Success Rate" value={`${data.overallRate}%`} />
            </div>

            {/* Pipeline Health Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Pipeline Health ({data.pipelines.length} pipelines)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider pb-2 border-b border-border">
                    <div className="col-span-4">Pipeline</div>
                    <div className="col-span-2 text-center">Status</div>
                    <div className="col-span-2 text-center">Success Rate</div>
                    <div className="col-span-2 text-center">Runs</div>
                    <div className="col-span-2 text-right">Last Run</div>
                  </div>
                  {data.pipelines.map((p) => (
                    <div key={p.name} className="grid grid-cols-12 gap-2 py-2 border-b border-border/20 items-center text-xs">
                      <div className="col-span-4 font-mono text-foreground truncate" title={p.name}>{p.name}</div>
                      <div className="col-span-2 flex justify-center">
                        {p.lastStatus === "success" ? (
                          <Badge variant="default" className="text-[9px] px-1.5 bg-success/20 text-success border-success/30">OK</Badge>
                        ) : p.lastStatus === "error" ? (
                          <Badge variant="destructive" className="text-[9px] px-1.5">FAIL</Badge>
                        ) : p.lastStatus === "warning" ? (
                          <Badge variant="secondary" className="text-[9px] px-1.5 bg-warning/20 text-warning border-warning/30">WARN</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[9px] px-1.5">IDLE</Badge>
                        )}
                      </div>
                      <div className="col-span-2 text-center">
                        <span className={p.successRate >= 95 ? "text-success" : p.successRate >= 80 ? "text-warning" : "text-destructive"}>
                          {p.successRate}%
                        </span>
                      </div>
                      <div className="col-span-2 text-center text-muted-foreground">{p.totalRuns}</div>
                      <div className="col-span-2 text-right text-muted-foreground">
                        {p.lastRun ? formatDistanceToNow(new Date(p.lastRun), { addSuffix: true }) : "never"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* AI Divisions Status */}
            {data.divisions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    AI Division Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {data.divisions.map((d: any) => (
                      <div key={d.name} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                        <div>
                          <p className="text-sm font-medium">{d.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Last check: {d.last_check ? formatDistanceToNow(new Date(d.last_check), { addSuffix: true }) : "—"}
                          </p>
                        </div>
                        <Badge variant={d.status === "operational" ? "default" : "destructive"} className="text-[9px]">
                          {d.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Transparency Note */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 text-xs text-muted-foreground">
                <strong className="text-foreground">Transparency:</strong> This page shows real operational data including the Data Truth Score — 
                a composite measure of entity link precision, event quality, metric coverage, and forecast usefulness. 
                Pipeline failures and data quality gaps are displayed openly. Truth validation runs daily at 06:00 UTC.
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </AICISLayout>
  );
};

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-lg font-orbitron font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default SystemStatus;
