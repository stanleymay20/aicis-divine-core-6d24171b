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

interface StatsSnapshot {
  snapped_at: string;
  metrics_total: number;
  entities_total: number;
  metric_links: number;
  event_links: number;
  entity_links: number;
  provenance_sources: number;
  reporting_countries: number;
  coverage_countries: number;
  metrics_country_coverage: number;
  link_to_metric_pct: number;
  provenance_pct: number;
  provenance_completeness_pct: number;
  duplicate_rate_pct: number;
  canonical_mismatches: number;
  job_offsets: Record<string, number>;
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

interface MismatchRow {
  issue_type: string;
  code: string;
  detail: string;
}

interface MilestoneCheck {
  check: string;
  passed: boolean;
  detail: string;
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
  const [snap, setSnap] = useState<StatsSnapshot | null>(null);
  const [cronHealth, setCronHealth] = useState<CronHealth[]>([]);
  const [mismatches, setMismatches] = useState<MismatchRow[]>([]);
  const [lastAudit, setLastAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [snapRes, cronRes, mmRes, auditRes] = await Promise.all([
        supabase.from("planetary_stats_snapshots" as any).select("*").order("snapped_at", { ascending: false }).limit(1).single(),
        supabase.from("planetary_cron_health" as any).select("*"),
        supabase.from("canonical_mismatch_audit" as any).select("*").limit(50),
        supabase.from("milestone_audit_log").select("*").order("audited_at", { ascending: false }).limit(1),
      ]);

      if (snapRes.data) setSnap(snapRes.data as any);
      if (cronRes.data) setCronHealth(cronRes.data as any);
      if (mmRes.data) setMismatches(mmRes.data as any);
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

  if (!snap) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Waiting for first stats snapshot (runs every 5 min)...</p>
        <Button variant="outline" size="sm" onClick={load} className="mt-2 gap-1">
          <RefreshCw className="h-3 w-3" /> Check again
        </Button>
      </Card>
    );
  }

  const metricsTotal = snap.metrics_total;
  const currentMilestone = MILESTONES.find(m => metricsTotal < m.value) ?? MILESTONES[MILESTONES.length - 1];
  const progressPct = Math.min((metricsTotal / currentMilestone.value) * 100, 100);

  const issuesByType: Record<string, MismatchRow[]> = {};
  mismatches.forEach(m => {
    if (!issuesByType[m.issue_type]) issuesByType[m.issue_type] = [];
    issuesByType[m.issue_type].push(m);
  });

  return (
    <div className="space-y-6">
      {/* Milestone Progress */}
      <Card className="border-primary/30 bg-card/80 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Planetary Scale Progress
            </span>
            <div className="flex gap-2">
              <span className="text-xs text-muted-foreground self-center">
                Snapshot: {new Date(snap.snapped_at).toLocaleTimeString()}
              </span>
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
          <div className="flex gap-2 flex-wrap">
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
          { label: "Metrics", value: snap.metrics_total, icon: Database, color: "text-primary" },
          { label: "Entities", value: snap.entities_total, icon: Globe, color: "text-primary" },
          { label: "Metric Links", value: snap.metric_links, icon: Link2, color: "text-primary" },
          { label: "Event Links", value: snap.event_links, icon: Link2, color: "text-muted-foreground" },
          { label: "Entity Links", value: snap.entity_links, icon: Link2, color: "text-primary" },
          { label: "Provenance Sources", value: snap.provenance_sources, icon: FileCheck, color: "text-primary" },
          { label: "Reporting Countries", value: snap.reporting_countries, icon: Globe, color: "text-primary" },
          { label: "Countries w/ Data", value: snap.metrics_country_coverage, icon: Globe, color: "text-primary" },
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

      {/* Ratios & Integrity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Link / Metric</span>
            <Badge variant={Number(snap.link_to_metric_pct) >= 1 ? "default" : "destructive"}>
              {snap.link_to_metric_pct}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Floor: ≥1% · Target: ≥10%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Provenance</span>
            <Badge variant={Number(snap.provenance_pct) >= 90 ? "default" : "destructive"}>
              {snap.provenance_pct}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Presence: ≥90%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Prov. Completeness</span>
            <Badge variant={Number(snap.provenance_completeness_pct) >= 70 ? "default" : "destructive"}>
              {snap.provenance_completeness_pct}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">4-field depth: ≥70%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Canonical Issues</span>
            <Badge variant={snap.canonical_mismatches === 0 ? "default" : "destructive"}>
              {snap.canonical_mismatches}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Unmapped source codes</p>
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
                    {job.error_count > 0 && <Badge variant="destructive" className="text-xs">{job.error_count} err</Badge>}
                    {job.timeout_count > 0 && <Badge variant="secondary" className="text-xs">{job.timeout_count} timeout</Badge>}
                    {job.still_running > 0 && <Badge variant="outline" className="text-xs">{job.still_running} running</Badge>}
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
            {Object.entries(snap.job_offsets || {}).map(([key, val]) => (
              <div key={key} className="p-2 rounded bg-muted/30 text-sm">
                <p className="font-mono text-xs truncate">{key}</p>
                <span className="font-bold">{fmt(val as number)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Canonical Mismatch Audit */}
      {mismatches.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Canonical Mismatch Audit ({mismatches.length} issues)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {Object.entries(issuesByType).map(([type, rows]) => (
                <div key={type}>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    {type.replace(/_/g, " ")} ({rows.length})
                  </p>
                  {rows.map(r => (
                    <div key={r.code + r.detail} className="flex items-center justify-between p-1.5 text-xs">
                      <span className="font-mono">{r.code}</span>
                      <span className="text-muted-foreground truncate ml-2">{r.detail}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
              Audited: {lastAudit.audited_at ? new Date(lastAudit.audited_at).toLocaleString() : "—"} · {fmt(lastAudit.metrics_total)} metrics
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
