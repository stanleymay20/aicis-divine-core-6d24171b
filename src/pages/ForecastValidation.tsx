import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertTriangle, Clock, CheckCircle2, Target, BarChart3, Layers, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SummaryStats {
  total: number;
  locked: number;
  pending: number;
  tp_total: number;
  tp_hits: number;
  tp_accuracy: number;
  avg_mae: number;
  direction_hit_rate: number;
  domain_count: number;
  country_count: number;
}

interface DomainRow {
  domain: string;
  sample_size: number;
  tp_accuracy: number;
  mae: number;
  status: string;
}

interface HorizonRow {
  horizon: string;
  sample_size: number;
  accuracy: number;
  mae: number;
}

interface ModelRow {
  model_version: string;
  sample_size: number;
  tp_accuracy: number;
  mae: number;
}

interface HealthAlert {
  type: string;
  severity: string;
  message: string;
  value: number;
}

export default function ForecastValidation() {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [horizons, setHorizons] = useState<HorizonRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [readiness, setReadiness] = useState<any>(null);
  const [health, setHealth] = useState<{ ok: boolean; alerts: HealthAlert[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [testRunning, setTestRunning] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [statsRes, domainsRes, horizonsRes, modelsRes, readinessRes] = await Promise.all([
        supabase.rpc("prospective_summary_stats"),
        supabase.rpc("prospective_domain_breakdown"),
        supabase.rpc("prospective_horizon_breakdown"),
        supabase.rpc("prospective_model_breakdown"),
        supabase.rpc("evaluate_forecast_readiness"),
      ]);

      if (statsRes.data) setStats(statsRes.data as unknown as SummaryStats);
      if (domainsRes.data) setDomains(domainsRes.data as unknown as DomainRow[]);
      if (horizonsRes.data) setHorizons(horizonsRes.data as unknown as HorizonRow[]);
      if (modelsRes.data) setModels(modelsRes.data as unknown as ModelRow[]);
      if (readinessRes.data) setReadiness(readinessRes.data);

      // Health check via edge function (needs write access for alerts)
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const resp = await fetch(
          `https://${projectId}.supabase.co/functions/v1/prospective-lifecycle-test`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
            body: JSON.stringify({ action: "health_check" }),
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.health) setHealth(data.health);
        }
      } catch {
        // health check is optional
      }
    } finally {
      setLoading(false);
    }
  }

  async function runLifecycleTest() {
    setTestRunning(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(
        `https://${projectId}.supabase.co/functions/v1/prospective-lifecycle-test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({ action: "lifecycle_test" }),
        }
      );
      const data = await resp.json();
      if (data.ok) {
        toast({ title: "Lifecycle Test Passed ✓", description: `Inserted → Realized → Locked in ${data.duration_ms}ms. Direction hit: ${data.direction_hit}` });
        loadAll();
      } else {
        toast({ title: "Lifecycle Test Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Test Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTestRunning(false);
    }
  }

  const sampleStatus = !stats ? "AWAITING_DATA" : stats.locked === 0 ? "AWAITING_DATA" : stats.locked < 30 ? "INSUFFICIENT_SAMPLE" : stats.locked < 50 ? "EMERGING" : readiness?.ready ? "DECISION_GRADE" : "EVALUABLE";

  const statusColor: Record<string, string> = {
    AWAITING_DATA: "bg-muted text-muted-foreground",
    INSUFFICIENT_SAMPLE: "bg-yellow-500/20 text-yellow-400",
    EMERGING: "bg-blue-500/20 text-blue-400",
    EVALUABLE: "bg-primary/20 text-primary",
    DECISION_GRADE: "bg-emerald-500/20 text-emerald-400",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Prospective Forecast Validation</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Clean, forward-looking forecast evaluation. No historical backfills or edits are included.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={runLifecycleTest} disabled={testRunning} className="shrink-0">
          {testRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FlaskConical className="h-3 w-3 mr-1" />}
          Lifecycle Test
        </Button>
      </div>

      {/* Health Alerts */}
      {health && !health.ok && (
        <div className="space-y-2">
          {health.alerts.map((alert, i) => (
            <div key={i} className={`rounded-lg px-4 py-2 flex items-center gap-2 text-xs ${alert.severity === "critical" ? "bg-destructive/20 text-destructive" : "bg-yellow-500/20 text-yellow-400"}`}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{alert.message}</span>
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={<Target className="h-4 w-4" />} label="Total Forecasts" value={stats?.total ?? 0} />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Awaiting Realization" value={stats?.pending ?? 0} />
        <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Realized (Locked)" value={stats?.locked ?? 0} />
        <SummaryCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Sample Status"
          value={(stats?.locked ?? 0) < 30 ? "Insufficient" : (stats?.locked ?? 0) < 100 ? "Emerging" : "Meaningful"}
          valueClass={(stats?.locked ?? 0) >= 100 ? "text-emerald-400" : (stats?.locked ?? 0) >= 30 ? "text-blue-400" : "text-yellow-400"}
        />
      </div>

      {/* Core Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Turning Point Accuracy" value={`${stats?.tp_accuracy ?? 0}%`} sub={`${stats?.tp_hits ?? 0}/${stats?.tp_total ?? 0} hits`} />
        <MetricCard label="Average MAE" value={stats?.avg_mae?.toFixed(2) ?? "—"} sub="Mean absolute error" />
        <MetricCard label="Direction Hit Rate" value={`${stats?.direction_hit_rate ?? 0}%`} sub="All directions" />
        <MetricCard label="Coverage" value={`${stats?.domain_count ?? 0}D / ${stats?.country_count ?? 0}C`} sub="Domains / Countries" />
      </div>

      {/* Breakdown Tables */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Layers className="h-4 w-4" /> By Domain</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">TP Acc</TableHead>
                  <TableHead className="text-right">MAE</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                ) : domains.map((d) => (
                  <TableRow key={d.domain}>
                    <TableCell className="font-medium text-xs">{d.domain}</TableCell>
                    <TableCell className="text-right text-xs">{d.sample_size}</TableCell>
                    <TableCell className="text-right text-xs">{d.tp_accuracy}%</TableCell>
                    <TableCell className="text-right text-xs">{d.mae}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={d.status === "good" ? "default" : d.status === "moderate" ? "secondary" : "destructive"} className="text-[10px]">
                        {d.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><BarChart3 className="h-4 w-4" /> By Horizon</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Horizon</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                  <TableHead className="text-right">MAE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {horizons.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                ) : horizons.map((h) => (
                  <TableRow key={h.horizon}>
                    <TableCell className="font-medium text-xs">{h.horizon}</TableCell>
                    <TableCell className="text-right text-xs">{h.sample_size}</TableCell>
                    <TableCell className="text-right text-xs">{h.accuracy}%</TableCell>
                    <TableCell className="text-right text-xs">{h.mae}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* By Model Version */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">By Model Version</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">n</TableHead>
                <TableHead className="text-right">TP Accuracy</TableHead>
                <TableHead className="text-right">MAE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
              ) : models.map((m) => (
                <TableRow key={m.model_version}>
                  <TableCell className="font-mono text-xs">{m.model_version}</TableCell>
                  <TableCell className="text-right text-xs">{m.sample_size}</TableCell>
                  <TableCell className="text-right text-xs">{m.tp_accuracy}%</TableCell>
                  <TableCell className="text-right text-xs">{m.mae}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Readiness Gate */}
      {readiness && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Promotion Gate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              {readiness.criteria && Object.entries(readiness.criteria as Record<string, boolean>).map(([key, passed]) => (
                <div key={key} className={`rounded-md p-2 text-center ${passed ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                  <div className="font-medium">{passed ? "✓" : "✗"}</div>
                  <div className="mt-1 opacity-80">{key.replace(/_/g, " ")}</div>
                </div>
              ))}
            </div>
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
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
        <div className={`text-xl font-bold ${valueClass ?? "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className="text-lg font-bold text-foreground">{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
