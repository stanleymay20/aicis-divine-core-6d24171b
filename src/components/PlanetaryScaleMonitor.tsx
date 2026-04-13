import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Database, Link2, FileCheck, Activity, AlertTriangle,
  CheckCircle2, XCircle, Loader2, RefreshCw, ShieldCheck, TrendingUp
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ScaleStatus {
  metrics_total: number;
  entities_total: number;
  metric_links_total: number;
  event_links_total: number;
  entity_links_total: number;
  provenance_sources: number;
  reporting_countries: number;
  coverage_countries: number;
  metrics_country_coverage: number;
  link_to_metric_pct: number;
  provenance_to_metric_pct: number;
}

interface JobOffset {
  job_key: string;
  current_offset: number;
  last_tick: string;
}

interface CronHealth {
  job_name: string;
  total_runs: number;
  success_count: number;
  error_count: number;
  timeout_count: number;
  still_running: number;
  last_run_at: string;
  success_rate_pct: number;
}

interface DupRate {
  provider_name: string;
  total_rows: number;
  unique_keys: number;
  estimated_conflicts: number;
  conflict_rate_pct: number;
}

interface MilestoneCheck {
  check: string;
  passed: boolean;
  detail: string;
  value?: number;
  threshold?: number;
}

interface AuditResult {
  milestone: string;
  metrics_total: number;
  all_passed: boolean;
  checks: MilestoneCheck[];
  audited_at: string;
}

const MILESTONES = [
  { label: "2M", value: 2_000_000 },
  { label: "5M", value: 5_000_000 },
  { label: "8M", value: 8_000_000 },
  { label: "10M", value: 10_000_000 },
];

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function PlanetaryScaleMonitor() {
  const [status, setStatus] = useState<ScaleStatus | null>(null);
  const [offsets, setOffsets] = useState<JobOffset[]>([]);
  const [cronHealth, setCronHealth] = useState<CronHealth[]>([]);
  const [dupRates, setDupRates] = useState<DupRate[]>([]);
  const [lastAudit, setLastAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [statusRes, offsetsRes, cronRes, dupRes, auditRes] = await Promise.all([
        supabase.from("planetary_scale_status" as any).select("*").single(),
        supabase.from("planetary_job_offsets" as any).select("*"),
        supabase.from("planetary_cron_health" as any).select("*"),
        supabase.from("planetary_duplicate_rate" as any).select("*").limit(10),
        supabase.from("milestone_audit_log").select("*").order("audited_at", { ascending: false }).limit(1),
      ]);

      if (statusRes.data) setStatus(statusRes.data as any);
      if (offsetsRes.data) setOffsets(offsetsRes.data as any);
      if (cronRes.data) setCronHealth(cronRes.data as any);
      if (dupRes.data) setDupRates(dupRes.data as any);
      if (auditRes.data?.[0]) {
        const raw = auditRes.data[0] as any;
        setLastAudit(raw.checks as AuditResult);
      }
    } catch (e) {
      console.error("Monitor load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const runAudit = async () => {
    setAuditing(true);
    try {
      const { data, error } = await supabase.rpc("run_milestone_audit" as any);
      if (error) throw error;
      setLastAudit(data as any);
      toast({ title: "Milestone Audit Complete", description: (data as any)?.all_passed ? "All checks passed ✓" : "Some checks need attention" });
      load();
    } catch (e) {
      toast({ title: "Audit Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAuditing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const metricsTotal = status?.metrics_total ?? 0;
  const currentMilestone = MILESTONES.find(m => metricsTotal < m.value) ?? MILESTONES[MILESTONES.length - 1];
  const progressPct = Math.min((metricsTotal / currentMilestone.value) * 100, 100);

  return (
    <div className="space-y-6">
      {/* Milestone Progress */}
      <Card className="border-primary/30 bg-card/80 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Planetary Scale Progress
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load} className="gap-1">
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
              <Button variant="default" size="sm" onClick={runAudit} disabled={auditing} className="gap-1">
                {auditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                Run Audit
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{fmt(metricsTotal)} metrics</span>
            <span className="text-muted-foreground">Next: {currentMilestone.label}</span>
          </div>
          <Progress value={progressPct} className="h-3" />
          <div className="flex gap-2">
            {MILESTONES.map(m => (
              <Badge key={m.label} variant={metricsTotal >= m.value ? "default" : "outline"} className="text-xs">
                {m.label} {metricsTotal >= m.value ? "✓" : ""}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Core Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {[
          { label: "Metrics", value: status?.metrics_total, icon: Database, color: "text-primary" },
          { label: "Entities", value: status?.entities_total, icon: Globe, color: "text-primary" },
          { label: "Metric Links", value: status?.metric_links_total, icon: Link2, color: "text-primary" },
          { label: "Event Links", value: status?.event_links_total, icon: Link2, color: "text-muted-foreground" },
          { label: "Entity Links", value: status?.entity_links_total, icon: Link2, color: "text-primary" },
          { label: "Provenance Sources", value: status?.provenance_sources, icon: FileCheck, color: "text-primary" },
          { label: "Reporting Countries", value: status?.reporting_countries, icon: Globe, color: "text-primary" },
          { label: "Countries w/ Data", value: status?.metrics_country_coverage, icon: Globe, color: "text-primary" },
        ].map(item => (
          <Card key={item.label} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <item.icon className={`h-4 w-4 ${item.color}`} />
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
            <p className="text-lg font-bold">{fmt(item.value ?? 0)}</p>
          </Card>
        ))}
      </div>

      {/* Ratios */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Link-to-Metric Ratio</span>
            <Badge variant={Number(status?.link_to_metric_pct ?? 0) >= 1 ? "default" : "destructive"}>
              {status?.link_to_metric_pct ?? 0}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Target: ≥ 1% (healthy graph connectivity)</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Provenance Coverage</span>
            <Badge variant={Number(status?.provenance_to_metric_pct ?? 0) >= 90 ? "default" : "destructive"}>
              {status?.provenance_to_metric_pct ?? 0}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Target: ≥ 90% (full audit trail)</p>
        </Card>
      </div>

      {/* Cron Job Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Cron Job Health (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {cronHealth.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cron runs in last 24h</p>
            ) : (
              cronHealth.map(job => (
                <div key={job.job_name} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs truncate">{job.job_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.total_runs} runs · Last: {job.last_run_at ? new Date(job.last_run_at).toLocaleTimeString() : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    {job.error_count > 0 && (
                      <Badge variant="destructive" className="text-xs">{job.error_count} err</Badge>
                    )}
                    {job.timeout_count > 0 && (
                      <Badge variant="secondary" className="text-xs">{job.timeout_count} timeout</Badge>
                    )}
                    {job.still_running > 0 && (
                      <Badge variant="outline" className="text-xs">{job.still_running} running</Badge>
                    )}
                    <Badge variant={job.success_rate_pct >= 90 ? "default" : "destructive"} className="text-xs">
                      {job.success_rate_pct}%
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Job Offsets */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Backfill Job Offsets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {offsets.map(o => (
              <div key={o.job_key} className="p-2 rounded bg-muted/30 text-sm">
                <p className="font-mono text-xs truncate">{o.job_key}</p>
                <div className="flex justify-between mt-1">
                  <span className="font-bold">{fmt(o.current_offset)}</span>
                  <span className="text-xs text-muted-foreground">
                    {o.last_tick ? new Date(o.last_tick).toLocaleTimeString() : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Duplicate Rates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Duplicate / Conflict Rate by Provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {dupRates.map(d => (
              <div key={d.provider_name} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                <div>
                  <p className="font-mono text-xs">{d.provider_name}</p>
                  <p className="text-xs text-muted-foreground">{fmt(d.total_rows)} rows · {fmt(d.unique_keys)} unique</p>
                </div>
                <Badge variant={d.conflict_rate_pct < 5 ? "default" : "destructive"} className="text-xs">
                  {d.conflict_rate_pct}% dup
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Last Milestone Audit */}
      {lastAudit && (
      <Card className={`border-2 ${lastAudit.all_passed ? "border-primary/30" : "border-destructive/30"}`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {lastAudit.all_passed ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              Milestone Audit: {lastAudit.milestone}
              <Badge variant={lastAudit.all_passed ? "default" : "destructive"}>
                {lastAudit.all_passed ? "ALL PASSED" : "NEEDS ATTENTION"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lastAudit.checks?.map((check, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {check.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium capitalize">{check.check.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground text-xs ml-auto">{check.detail}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Audited: {lastAudit.audited_at ? new Date(lastAudit.audited_at).toLocaleString() : "—"} · {fmt(lastAudit.metrics_total)} metrics at audit
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
