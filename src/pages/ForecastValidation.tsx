import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ShieldCheck, AlertTriangle, Clock, CheckCircle2, Target, BarChart3, Layers } from "lucide-react";

interface ProspectiveStats {
  total: number;
  locked: number;
  pending: number;
  tp_total: number;
  tp_hits: number;
  tp_accuracy: number;
  avg_mae: number;
  direction_hit_rate: number;
  domains: string[];
  countries: string[];
}

interface DomainBreakdown {
  domain: string;
  sample_size: number;
  tp_accuracy: number;
  mae: number;
  status: string;
}

interface HorizonBreakdown {
  horizon: string;
  sample_size: number;
  accuracy: number;
  mae: number;
}

interface ModelBreakdown {
  model_version: string;
  sample_size: number;
  tp_accuracy: number;
  mae: number;
}

export default function ForecastValidation() {
  const [stats, setStats] = useState<ProspectiveStats | null>(null);
  const [domains, setDomains] = useState<DomainBreakdown[]>([]);
  const [horizons, setHorizons] = useState<HorizonBreakdown[]>([]);
  const [models, setModels] = useState<ModelBreakdown[]>([]);
  const [readiness, setReadiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadStats(), loadDomains(), loadHorizons(), loadModels(), loadReadiness()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    const { data } = await supabase
      .from("forecast_prospective_evaluations")
      .select("evaluation_locked, realized_direction, direction_hit, absolute_error, domain, iso3")
      .limit(1000);

    if (!data) return;

    const locked = data.filter((d) => d.evaluation_locked);
    const tp = locked.filter((d) => d.realized_direction && d.realized_direction !== "stable");
    const tpHits = tp.filter((d) => d.direction_hit).length;
    const dirHits = locked.filter((d) => d.direction_hit).length;
    const maes = locked.filter((d) => d.absolute_error != null).map((d) => d.absolute_error!);

    setStats({
      total: data.length,
      locked: locked.length,
      pending: data.length - locked.length,
      tp_total: tp.length,
      tp_hits: tpHits,
      tp_accuracy: tp.length > 0 ? Math.round((tpHits / tp.length) * 100) : 0,
      avg_mae: maes.length > 0 ? Math.round((maes.reduce((a, b) => a + Number(b), 0) / maes.length) * 100) / 100 : 0,
      direction_hit_rate: locked.length > 0 ? Math.round((dirHits / locked.length) * 100) : 0,
      domains: [...new Set(data.map((d) => d.domain))],
      countries: [...new Set(data.map((d) => d.iso3).filter(Boolean))],
    });
  }

  async function loadDomains() {
    const { data } = await supabase
      .from("forecast_prospective_evaluations")
      .select("domain, direction_hit, absolute_error, realized_direction")
      .eq("evaluation_locked", true)
      .limit(1000);

    if (!data) return;

    const byDomain: Record<string, typeof data> = {};
    data.forEach((d) => {
      if (!byDomain[d.domain]) byDomain[d.domain] = [];
      byDomain[d.domain].push(d);
    });

    setDomains(
      Object.entries(byDomain).map(([domain, rows]) => {
        const tp = rows.filter((r) => r.realized_direction && r.realized_direction !== "stable");
        const tpHits = tp.filter((r) => r.direction_hit).length;
        const maes = rows.filter((r) => r.absolute_error != null).map((r) => Number(r.absolute_error));
        const accuracy = tp.length > 0 ? Math.round((tpHits / tp.length) * 100) : 0;
        return {
          domain,
          sample_size: rows.length,
          tp_accuracy: accuracy,
          mae: maes.length > 0 ? Math.round((maes.reduce((a, b) => a + b, 0) / maes.length) * 100) / 100 : 0,
          status: accuracy >= 60 ? "good" : accuracy >= 30 ? "moderate" : "weak",
        };
      }).sort((a, b) => b.sample_size - a.sample_size)
    );
  }

  async function loadHorizons() {
    const { data } = await supabase
      .from("forecast_prospective_evaluations")
      .select("horizon_days, direction_hit, absolute_error")
      .eq("evaluation_locked", true)
      .limit(1000);

    if (!data) return;

    const buckets: Record<string, typeof data> = {};
    data.forEach((d) => {
      const label = d.horizon_days <= 7 ? "7d" : d.horizon_days <= 14 ? "14d" : d.horizon_days <= 30 ? "30d" : d.horizon_days <= 60 ? "60d" : "90d+";
      if (!buckets[label]) buckets[label] = [];
      buckets[label].push(d);
    });

    setHorizons(
      Object.entries(buckets).map(([horizon, rows]) => {
        const hits = rows.filter((r) => r.direction_hit).length;
        const maes = rows.filter((r) => r.absolute_error != null).map((r) => Number(r.absolute_error));
        return {
          horizon,
          sample_size: rows.length,
          accuracy: rows.length > 0 ? Math.round((hits / rows.length) * 100) : 0,
          mae: maes.length > 0 ? Math.round((maes.reduce((a, b) => a + b, 0) / maes.length) * 100) / 100 : 0,
        };
      })
    );
  }

  async function loadModels() {
    const { data } = await supabase
      .from("forecast_prospective_evaluations")
      .select("model_version, direction_hit, absolute_error, realized_direction")
      .eq("evaluation_locked", true)
      .limit(1000);

    if (!data) return;

    const byModel: Record<string, typeof data> = {};
    data.forEach((d) => {
      if (!byModel[d.model_version]) byModel[d.model_version] = [];
      byModel[d.model_version].push(d);
    });

    setModels(
      Object.entries(byModel).map(([model_version, rows]) => {
        const tp = rows.filter((r) => r.realized_direction && r.realized_direction !== "stable");
        const tpHits = tp.filter((r) => r.direction_hit).length;
        const maes = rows.filter((r) => r.absolute_error != null).map((r) => Number(r.absolute_error));
        return {
          model_version,
          sample_size: rows.length,
          tp_accuracy: tp.length > 0 ? Math.round((tpHits / tp.length) * 100) : 0,
          mae: maes.length > 0 ? Math.round((maes.reduce((a, b) => a + b, 0) / maes.length) * 100) / 100 : 0,
        };
      }).sort((a, b) => b.sample_size - a.sample_size)
    );
  }

  async function loadReadiness() {
    const { data, error } = await supabase.rpc("evaluate_forecast_readiness");
    if (!error && data) setReadiness(data);
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
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Prospective Forecast Validation</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Clean, forward-looking forecast evaluation. No historical backfills or edits are included in these scores.
        </p>
      </div>

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
          value={
            (stats?.locked ?? 0) < 30 ? "Insufficient" : (stats?.locked ?? 0) < 100 ? "Emerging" : "Meaningful"
          }
          valueClass={(stats?.locked ?? 0) >= 100 ? "text-emerald-400" : (stats?.locked ?? 0) >= 30 ? "text-blue-400" : "text-yellow-400"}
        />
      </div>

      {/* Core Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Turning Point Accuracy" value={`${stats?.tp_accuracy ?? 0}%`} sub={`${stats?.tp_hits ?? 0}/${stats?.tp_total ?? 0} hits`} />
        <MetricCard label="Average MAE" value={stats?.avg_mae?.toFixed(2) ?? "—"} sub="Mean absolute error" />
        <MetricCard label="Direction Hit Rate" value={`${stats?.direction_hit_rate ?? 0}%`} sub="All directions" />
        <MetricCard label="Coverage" value={`${stats?.domains?.length ?? 0}D / ${stats?.countries?.length ?? 0}C`} sub="Domains / Countries" />
      </div>

      {/* Breakdown Tables */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* By Domain */}
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

        {/* By Horizon */}
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
