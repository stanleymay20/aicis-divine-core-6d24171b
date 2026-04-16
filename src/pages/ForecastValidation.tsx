import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertTriangle, Clock, CheckCircle2, Target, BarChart3, Layers, FlaskConical, Activity, Search, TrendingUp, Radio, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SummaryStats {
  total: number; locked: number; pending: number;
  tp_total: number; tp_hits: number; tp_accuracy: number;
  avg_mae: number; direction_hit_rate: number;
  domain_count: number; country_count: number;
}
interface DomainRow { domain: string; sample_size: number; tp_accuracy: number; mae: number; status: string; }
interface HorizonRow { horizon: string; sample_size: number; accuracy: number; mae: number; }
interface ModelRow { model_version: string; sample_size: number; tp_accuracy: number; mae: number; }
interface HealthAlert { type: string; severity: string; message: string; value: number; }
interface DomainPolicy { domain: string; match_window_days: number; direction_threshold_pct: number; preferred_period_type: string; is_active: boolean; notes: string; }

export default function ForecastValidation() {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [horizons, setHorizons] = useState<HorizonRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [readiness, setReadiness] = useState<any>(null);
  const [health, setHealth] = useState<{ ok: boolean; alerts: HealthAlert[] } | null>(null);
  const [accumulation, setAccumulation] = useState<any>(null);
  const [matchQuality, setMatchQuality] = useState<any>(null);
  const [coverageGaps, setCoverageGaps] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [policies, setPolicies] = useState<DomainPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [testRunning, setTestRunning] = useState(false);
  const { toast } = useToast();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [statsRes, domainsRes, horizonsRes, modelsRes, readinessRes, accumRes, matchRes, gapsRes, snapshotsRes, policiesRes] = await Promise.all([
        supabase.rpc("prospective_summary_stats"),
        supabase.rpc("prospective_domain_breakdown"),
        supabase.rpc("prospective_horizon_breakdown"),
        supabase.rpc("prospective_model_breakdown"),
        supabase.rpc("evaluate_forecast_readiness"),
        supabase.rpc("prospective_accumulation_monitor"),
        supabase.rpc("audit_prospective_match_quality"),
        supabase.rpc("prospective_coverage_gaps"),
        supabase.from("forecast_prospective_health_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(30),
        supabase.from("forecast_domain_match_policies").select("*").order("domain"),
      ]);
      if (statsRes.data) setStats(statsRes.data as unknown as SummaryStats);
      if (domainsRes.data) setDomains(domainsRes.data as unknown as DomainRow[]);
      if (horizonsRes.data) setHorizons(horizonsRes.data as unknown as HorizonRow[]);
      if (modelsRes.data) setModels(modelsRes.data as unknown as ModelRow[]);
      if (readinessRes.data) setReadiness(readinessRes.data);
      if (accumRes.data) setAccumulation(accumRes.data);
      if (matchRes.data) setMatchQuality(matchRes.data);
      if (gapsRes.data) setCoverageGaps(gapsRes.data);
      if (snapshotsRes.data) setSnapshots(snapshotsRes.data);
      if (policiesRes.data) setPolicies(policiesRes.data as unknown as DomainPolicy[]);

      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/prospective-lifecycle-test`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({ action: "health_check" }),
        });
        if (resp.ok) { const data = await resp.json(); if (data.health) setHealth(data.health); }
      } catch { /* optional */ }
    } finally { setLoading(false); }
  }

  async function runLifecycleTest() {
    setTestRunning(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/prospective-lifecycle-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ action: "lifecycle_test" }),
      });
      const data = await resp.json();
      if (data.ok) {
        toast({ title: "Lifecycle Test Passed ✓", description: `Inserted → Realized → Locked in ${data.duration_ms}ms` });
        loadAll();
      } else {
        toast({ title: "Lifecycle Test Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Test Error", description: (e as Error).message, variant: "destructive" });
    } finally { setTestRunning(false); }
  }

  async function takeSnapshot() {
    const { error } = await supabase.rpc("snapshot_prospective_health");
    if (error) toast({ title: "Snapshot failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Snapshot saved" }); loadAll(); }
  }

  const sampleStatus = !stats ? "AWAITING_DATA" : stats.locked === 0 ? "AWAITING_DATA" : stats.locked < 30 ? "INSUFFICIENT_SAMPLE" : stats.locked < 50 ? "EMERGING" : readiness?.ready ? "DECISION_GRADE" : "EVALUABLE";
  const statusColor: Record<string, string> = {
    AWAITING_DATA: "bg-muted text-muted-foreground", INSUFFICIENT_SAMPLE: "bg-yellow-500/20 text-yellow-400",
    EMERGING: "bg-blue-500/20 text-blue-400", EVALUABLE: "bg-primary/20 text-primary",
    DECISION_GRADE: "bg-emerald-500/20 text-emerald-400",
  };
  const accumStatusColor: Record<string, string> = {
    STALLED: "text-destructive", LOW_VOLUME: "text-yellow-400", HEALTHY: "text-blue-400", GROWING: "text-emerald-400",
  };

  // Compute policy coverage stats
  const activePolicies = policies.filter(p => p.is_active);
  const domainNames = domains.map(d => d.domain);
  const coveredDomains = domainNames.filter(d => activePolicies.some(p => p.domain === d));
  const fallbackDomains = domainNames.filter(d => !activePolicies.some(p => p.domain === d));
  const fallbackRate = domainNames.length > 0 ? Math.round((fallbackDomains.length / domainNames.length) * 100) : 0;

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Prospective Forecast Validation</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">Clean, forward-looking forecast evaluation. No historical backfills or edits are included.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={takeSnapshot}><Activity className="h-3 w-3 mr-1" />Snapshot</Button>
          <Button variant="outline" size="sm" onClick={runLifecycleTest} disabled={testRunning}>
            {testRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FlaskConical className="h-3 w-3 mr-1" />}Lifecycle Test
          </Button>
        </div>
      </div>

      {/* Health Alerts */}
      {health && !health.ok && (
        <div className="space-y-2">
          {health.alerts.map((alert, i) => (
            <div key={i} className={`rounded-lg px-4 py-2 flex items-center gap-2 text-xs ${alert.severity === "critical" ? "bg-destructive/20 text-destructive" : "bg-yellow-500/20 text-yellow-400"}`}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Status Banner */}
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

      {/* Accumulation Monitor */}
      {accumulation && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radio className="h-4 w-4" /> Live Accumulation
              <Badge variant="outline" className={`ml-auto text-[10px] ${accumStatusColor[accumulation.accumulation_status] ?? ""}`}>{accumulation.accumulation_status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <MiniStat label="New (24h)" value={accumulation.new_24h} />
              <MiniStat label="New (7d)" value={accumulation.new_7d} />
              <MiniStat label="Realized (24h)" value={accumulation.realized_24h} />
              <MiniStat label="Realized (7d)" value={accumulation.realized_7d} />
              <MiniStat label="Locked" value={accumulation.locked} />
              <MiniStat label="Unlocked" value={accumulation.unlocked} />
              <MiniStat label="Overdue" value={accumulation.overdue} warn={accumulation.overdue > 0} />
              <MiniStat label="Missing actual" value={accumulation.missing_actual} warn={accumulation.missing_actual > 0} />
              <MiniStat label="Duplicates" value={accumulation.duplicates} warn={accumulation.duplicates > 0} />
              <MiniStat label="Domains" value={accumulation.domains} />
              <MiniStat label="Countries" value={accumulation.countries} />
              <MiniStat label="Models" value={accumulation.models} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={<Target className="h-4 w-4" />} label="Total Forecasts" value={stats?.total ?? 0} />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Awaiting Realization" value={stats?.pending ?? 0} />
        <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Realized (Locked)" value={stats?.locked ?? 0} />
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="Sample Status"
          value={(stats?.locked ?? 0) < 30 ? "Insufficient" : (stats?.locked ?? 0) < 100 ? "Emerging" : "Meaningful"}
          valueClass={(stats?.locked ?? 0) >= 100 ? "text-emerald-400" : (stats?.locked ?? 0) >= 30 ? "text-blue-400" : "text-yellow-400"} />
      </div>

      {/* Core Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Turning Point Accuracy" value={`${stats?.tp_accuracy ?? 0}%`} sub={`${stats?.tp_hits ?? 0}/${stats?.tp_total ?? 0} hits`} />
        <MetricCard label="Average MAE" value={stats?.avg_mae?.toFixed(2) ?? "—"} sub="Mean absolute error" />
        <MetricCard label="Direction Hit Rate" value={`${stats?.direction_hit_rate ?? 0}%`} sub="All directions" />
        <MetricCard label="Coverage" value={`${stats?.domain_count ?? 0}D / ${stats?.country_count ?? 0}C`} sub="Domains / Countries" />
      </div>

      {/* Match Policy Coverage */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Match Policy Coverage
            <Badge variant="outline" className={`ml-auto text-[10px] ${fallbackRate > 30 ? "text-yellow-400" : "text-emerald-400"}`}>
              {fallbackRate === 0 ? "Full Coverage" : `${fallbackRate}% fallback`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <MiniStat label="Active policies" value={activePolicies.length} />
            <MiniStat label="Domains with policy" value={coveredDomains.length} />
            <MiniStat label="Domains on fallback" value={fallbackDomains.length} warn={fallbackDomains.length > 0} />
            <MiniStat label="Fallback rate" value={`${matchQuality?.fallback_rate_pct ?? fallbackRate}%`} warn={(matchQuality?.fallback_rate_pct ?? fallbackRate) > 30} />
          </div>

          {/* Policy table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Domain</TableHead>
                <TableHead className="text-right text-xs">Window (days)</TableHead>
                <TableHead className="text-right text-xs">Threshold %</TableHead>
                <TableHead className="text-xs">Period</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activePolicies.map((p) => (
                <TableRow key={p.domain}>
                  <TableCell className="text-xs font-medium">{p.domain}</TableCell>
                  <TableCell className="text-right text-xs">{p.match_window_days}</TableCell>
                  <TableCell className="text-right text-xs">{p.direction_threshold_pct}%</TableCell>
                  <TableCell className="text-xs">{p.preferred_period_type ?? "—"}</TableCell>
                  <TableCell><Badge variant="default" className="text-[10px]">Active</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {fallbackDomains.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">Domains needing policy tuning</p>
              <div className="flex flex-wrap gap-1">
                {fallbackDomains.map(d => <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>)}
              </div>
            </div>
          )}

          {/* Suspicious domains from match quality */}
          {matchQuality?.suspicious_domains?.length > 0 && (
            <div>
              <p className="text-xs text-destructive mb-1 font-medium">Suspicious domains (high missing rate or delay)</p>
              <div className="space-y-1">
                {matchQuality.suspicious_domains.map((s: any, i: number) => (
                  <div key={i} className="text-xs bg-destructive/10 text-destructive rounded px-2 py-1">
                    <span className="font-medium">{s.domain}</span> — {s.reason === "high_missing_actual" ? `${s.missing_rate}% missing` : `avg delay ${s.avg_delay}d`}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Policy vs fallback match breakdown */}
          {matchQuality && matchQuality.sample_size > 0 && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <MiniStat label="Policy-backed matches" value={matchQuality.policy_backed_matches ?? 0} />
              <MiniStat label="Fallback matches" value={matchQuality.fallback_matches ?? 0} warn={(matchQuality.fallback_matches ?? 0) > 0} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Match Quality */}
      {matchQuality && matchQuality.sample_size > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Search className="h-4 w-4" /> Match Quality Audit
              <Badge variant="outline" className="ml-auto text-[10px]">Score: {matchQuality.quality_score ?? "—"}/100</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <MiniStat label="Matched ≤1d" value={matchQuality.matched_within_1d} />
              <MiniStat label="Matched ≤3d" value={matchQuality.matched_within_3d} />
              <MiniStat label="Matched ≤7d" value={matchQuality.matched_within_7d} />
              <MiniStat label="Avg delay (days)" value={matchQuality.average_match_delay_days} />
              <MiniStat label="Null actuals" value={matchQuality.rows_with_null_actuals} warn={matchQuality.rows_with_null_actuals > 0} />
              <MiniStat label="Missing ISO3" value={matchQuality.rows_with_missing_iso3} warn={matchQuality.rows_with_missing_iso3 > 0} />
            </div>
            {/* Domain delays */}
            {matchQuality.domain_delays?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">Avg match delay by domain</p>
                <div className="flex flex-wrap gap-2">
                  {matchQuality.domain_delays.map((dd: any) => (
                    <div key={dd.domain} className={`bg-muted rounded px-2 py-1 text-xs ${dd.avg_delay > 5 ? "text-yellow-400" : ""}`}>
                      <span className="font-medium">{dd.domain}</span>: {dd.avg_delay}d ({dd.count})
                    </div>
                  ))}
                </div>
              </div>
            )}
            {matchQuality.samples?.length > 0 && (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">Domain</TableHead><TableHead className="text-xs">ISO3</TableHead>
                  <TableHead className="text-xs">Due</TableHead><TableHead className="text-xs">Delay</TableHead>
                  <TableHead className="text-xs">Policy</TableHead><TableHead className="text-xs">Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {matchQuality.samples.slice(0, 5).map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{s.domain}</TableCell>
                      <TableCell className="text-xs">{s.iso3}</TableCell>
                      <TableCell className="text-xs">{s.realization_due_at?.slice(0, 10)}</TableCell>
                      <TableCell className="text-xs">{s.delay_days ?? "—"}d</TableCell>
                      <TableCell><Badge variant={s.policy_status === "domain_policy" ? "default" : "secondary"} className="text-[10px]">{s.policy_status ?? "—"}</Badge></TableCell>
                      <TableCell><Badge variant={s.status === "matched" ? "default" : "destructive"} className="text-[10px]">{s.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Promotion Readiness */}
      {readiness && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Promotion Readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className={`rounded-md p-3 text-sm font-medium ${readiness.ready ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {readiness.status === "AWAITING_DATA" && "Not enough evidence yet — forecasts are accumulating."}
              {readiness.status === "INSUFFICIENT_SAMPLE" && `Evidence building — ${readiness.sample_size} realized so far (need 30+).`}
              {readiness.status === "EMERGING" && `Evidence building — ${readiness.sample_size} realized, approaching threshold.`}
              {readiness.status === "EVALUABLE" && "Evidence is substantial but not all criteria are met for external claims."}
              {readiness.status === "DECISION_GRADE" && "Ready for external forecast claims — all criteria passed."}
            </div>
            {readiness.criteria && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                {Object.entries(readiness.criteria as Record<string, boolean>).map(([key, passed]) => (
                  <div key={key} className={`rounded-md p-2 text-center ${passed ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                    <div className="font-medium">{passed ? "✓" : "✗"}</div>
                    <div className="mt-1 opacity-80">{key.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Coverage Gaps */}
      {coverageGaps && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Coverage Gaps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground mb-1 font-medium">Domains with no realized data</p>
                {coverageGaps.domains_no_realized?.length > 0
                  ? <div className="flex flex-wrap gap-1">{coverageGaps.domains_no_realized.map((d: string) => <Badge key={d} variant="destructive" className="text-[10px]">{d}</Badge>)}</div>
                  : <span className="text-muted-foreground">None — all domains have realized data</span>}
              </div>
              <div>
                <p className="text-muted-foreground mb-1 font-medium">Countries with no realized data</p>
                {coverageGaps.countries_no_realized?.length > 0
                  ? <div className="flex flex-wrap gap-1">{coverageGaps.countries_no_realized.slice(0, 20).map((c: string) => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}</div>
                  : <span className="text-muted-foreground">None</span>}
              </div>
            </div>
            {coverageGaps.horizon_coverage?.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1 font-medium">Horizon coverage</p>
                <div className="flex flex-wrap gap-2">
                  {coverageGaps.horizon_coverage.map((h: any) => (
                    <div key={h.horizon_days} className="bg-muted rounded px-2 py-1">
                      <span className="font-mono">{h.horizon_days}d</span>: {h.realized}/{h.total} realized {h.avg_mae != null && `(MAE ${h.avg_mae})`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Breakdown Tables */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><Layers className="h-4 w-4" /> By Domain</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Domain</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">TP Acc</TableHead><TableHead className="text-right">MAE</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {domains.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                  : domains.map((d) => (
                    <TableRow key={d.domain}>
                      <TableCell className="font-medium text-xs">{d.domain}</TableCell>
                      <TableCell className="text-right text-xs">{d.sample_size}</TableCell>
                      <TableCell className="text-right text-xs">{d.tp_accuracy}%</TableCell>
                      <TableCell className="text-right text-xs">{d.mae}</TableCell>
                      <TableCell className="text-right"><Badge variant={d.status === "good" ? "default" : d.status === "moderate" ? "secondary" : "destructive"} className="text-[10px]">{d.status}</Badge></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><BarChart3 className="h-4 w-4" /> By Horizon</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Horizon</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">Accuracy</TableHead><TableHead className="text-right">MAE</TableHead></TableRow></TableHeader>
              <TableBody>
                {horizons.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                  : horizons.map((h) => (
                    <TableRow key={h.horizon}><TableCell className="font-medium text-xs">{h.horizon}</TableCell><TableCell className="text-right text-xs">{h.sample_size}</TableCell><TableCell className="text-right text-xs">{h.accuracy}%</TableCell><TableCell className="text-right text-xs">{h.mae}</TableCell></TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* By Model Version */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">By Model Version</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Model</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">TP Accuracy</TableHead><TableHead className="text-right">MAE</TableHead></TableRow></TableHeader>
            <TableBody>
              {models.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                : models.map((m) => (
                  <TableRow key={m.model_version}><TableCell className="font-mono text-xs">{m.model_version}</TableCell><TableCell className="text-right text-xs">{m.sample_size}</TableCell><TableCell className="text-right text-xs">{m.tp_accuracy}%</TableCell><TableCell className="text-right text-xs">{m.mae}</TableCell></TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Health Trend */}
      {snapshots.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Health History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Date</TableHead><TableHead className="text-right text-xs">Total</TableHead><TableHead className="text-right text-xs">Realized</TableHead>
                <TableHead className="text-right text-xs">TP Acc</TableHead><TableHead className="text-right text-xs">MAE</TableHead>
                <TableHead className="text-right text-xs">Domains</TableHead><TableHead className="text-right text-xs">Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {snapshots.slice(0, 10).map((s: any) => (
                  <TableRow key={s.snapshot_date}>
                    <TableCell className="text-xs font-mono">{s.snapshot_date}</TableCell>
                    <TableCell className="text-right text-xs">{s.total_forecasts}</TableCell>
                    <TableCell className="text-right text-xs">{s.realized_count}</TableCell>
                    <TableCell className="text-right text-xs">{s.tp_accuracy != null ? `${s.tp_accuracy}%` : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{s.avg_mae ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{s.domains_covered}</TableCell>
                    <TableCell className="text-right"><Badge variant="outline" className="text-[10px]">{s.accumulation_status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Trust Disclaimer */}
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

function SummaryCard({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string | number; valueClass?: string }) {
  return (
    <Card className="bg-card border-border"><CardContent className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
      <div className={`text-xl font-bold ${valueClass ?? "text-foreground"}`}>{value}</div>
    </CardContent></Card>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="bg-card border-border"><CardContent className="p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </CardContent></Card>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className={`rounded-md p-2 ${warn ? "bg-destructive/10" : "bg-muted/50"}`}>
      <div className={`text-lg font-bold ${warn ? "text-destructive" : "text-foreground"}`}>{value ?? 0}</div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
    </div>
  );
}
