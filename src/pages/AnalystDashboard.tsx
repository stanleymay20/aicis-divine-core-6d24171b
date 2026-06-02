import { useMemo, useState } from "react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PlanetaryOperationsMap } from "@/components/aicis/PlanetaryOperationsMap";
import { RealtimeOperationsStream } from "@/components/aicis/RealtimeOperationsStream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { Activity, AlertTriangle, Database, Globe2, ShieldAlert, Users, Gauge, RefreshCw } from "lucide-react";
import { ParallelCoordinatesChart } from "@/components/visualizations/ParallelCoordinatesChart";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { useQueryClient } from "@tanstack/react-query";
import { fmt, FilterChip, KpiTile } from "@/components/analyst-dashboard/shared";
import { useAnalystKpis, useTrendSeries, useThreatMatrix, useTopThreats } from "@/components/analyst-dashboard/queries";
import { ThreatMatrix } from "@/components/analyst-dashboard/ThreatMatrix";
import { RiskTrendCard } from "@/components/analyst-dashboard/RiskTrendCard";
import { TopThreatsCard } from "@/components/analyst-dashboard/TopThreatsCard";
import { CausalNetworkCard } from "@/components/analyst-dashboard/CausalNetworkCard";
import { ScenarioProjectionsCard } from "@/components/analyst-dashboard/ScenarioProjectionsCard";
import { DataSourceHealthCard } from "@/components/analyst-dashboard/DataSourceHealthCard";

export default function AnalystDashboard() {
  const qc = useQueryClient();
  const kpis = useAnalystKpis();
  const trend = useTrendSeries();
  const matrix = useThreatMatrix();
  const top = useTopThreats();

  // Sparklines derived from live 24h event series — last 16 hourly buckets per category.
  const sparkSeries = useMemo(() => {
    const rows = (trend.data ?? []) as any[];
    const tail = rows.slice(-16);
    const build = (key: string) => tail.map(r => ({ v: Number(r[key] ?? 0) }));
    return {
      global: build("global"),
      cyber: build("cyber"),
      economic: build("economic"),
      environmental: build("environmental"),
      geopolitical: build("geopolitical"),
    };
  }, [trend.data]);

  const k = kpis.data;
  const sourceHealth = useMemo(() => {
    const total = k?.sourcesTotal || 312;
    const online = k?.sourcesOnline || 284;
    const degraded = Math.max(0, Math.round(total * 0.06));
    const offline = Math.max(0, total - online - degraded);
    return [
      { name: "Online", value: online, color: "#10b981" },
      { name: "Degraded", value: degraded, color: "#f59e0b" },
      { name: "Offline", value: offline, color: "#ef4444" },
    ];
  }, [k]);

  return (
    <AICISLayout>
      <SEO title="Analyst Dashboard — AICIS" description="Dense operational intelligence: live signals, threat matrix, causal propagation, scenario projections." path="/analyst" />
      <div className="p-4 md:p-5 max-w-[1500px] mx-auto h-full overflow-y-auto space-y-4 animate-fade-in">

        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-cyan-400" />
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Analyst Dashboard</h1>
              <Badge variant="outline" className="uppercase tracking-wider text-[10px] border-rose-500/40 text-rose-300 bg-rose-500/10">
                Threat Level · {k && k.criticalAlerts > 5 ? "HIGH" : k && k.criticalAlerts > 0 ? "ELEVATED" : "STABLE"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              System time {new Date().toISOString().replace("T", " ").slice(0, 19)} UTC · operational intelligence surface
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 h-8 px-3">Auto refresh ON</Badge>
            <Button size="sm" variant="outline" onClick={() => {
              qc.invalidateQueries({ queryKey: ["analyst-kpis"] });
              qc.invalidateQueries({ queryKey: ["analyst-trend-24h"] });
              qc.invalidateQueries({ queryKey: ["analyst-threat-matrix"] });
              qc.invalidateQueries({ queryKey: ["analyst-top-threats"] });
            }} className="h-8">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center rounded-lg border border-border bg-card/50 p-2">
          <FilterChip label="Global View" />
          <FilterChip label="All Domains" />
          <FilterChip label="All Regions" />
          <FilterChip label="Last 6 Hours" />
          <FilterChip label="Custom Filters" />
          <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto">Reset</Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <PanelBoundary><KpiTile icon={Gauge} label="Global Risk" value={fmt(k?.globalRisk)} suffix="/100" delta={k?.eventsDelta ?? 0} deltaLabel="6h" sparkColor="#ef4444" sparkData={sparkSeries.global} loading={kpis.isLoading} /></PanelBoundary>
          <PanelBoundary><KpiTile icon={AlertTriangle} label="Active Incidents" value={fmt(k?.activeAlerts)} delta={k?.eventsDelta ?? 0} deltaLabel="vs 6h" sparkColor="#f97316" sparkData={sparkSeries.global} loading={kpis.isLoading} /></PanelBoundary>
          <PanelBoundary><KpiTile icon={ShieldAlert} label="Systemic Threats" value={fmt(k?.systemicThreats)} delta={null} deltaLabel="≥75 score" sparkColor="#a78bfa" sparkData={sparkSeries.geopolitical} loading={kpis.isLoading} /></PanelBoundary>
          <PanelBoundary><KpiTile icon={Users} label="Countries at Risk" value={fmt(k?.countriesAtRisk)} delta={null} deltaLabel="≥75 score" sparkColor="#fbbf24" sparkData={sparkSeries.economic} loading={kpis.isLoading} /></PanelBoundary>
          <PanelBoundary><KpiTile icon={Activity} label="Confidence" value={`${fmt(k?.confidence)}%`} delta={null} deltaLabel="rolling" sparkColor="#10b981" sparkData={sparkSeries.environmental} loading={kpis.isLoading} /></PanelBoundary>
          <PanelBoundary><KpiTile icon={Database} label="Data Sources" value={fmt(k?.sourcesTotal)} delta={null} deltaLabel={`${k?.sourcesOnline ?? 0} online`} sparkColor="#22d3ee" sparkData={sparkSeries.cyber} loading={kpis.isLoading} /></PanelBoundary>
        </div>


        <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Globe2 className="h-4 w-4 text-cyan-400" /> Global Situational Map</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <PanelBoundary><PlanetaryOperationsMap /></PanelBoundary>
            </CardContent>
          </Card>
          <PanelBoundary><RealtimeOperationsStream /></PanelBoundary>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr_1fr] gap-4">
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Threat Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <PanelBoundary><ThreatMatrix data={matrix.data} /></PanelBoundary>
            </CardContent>
          </Card>
          <PanelBoundary><RiskTrendCard loading={trend.isLoading} data={trend.data} /></PanelBoundary>
          <PanelBoundary><TopThreatsCard loading={top.isLoading} data={top.data} /></PanelBoundary>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1.4fr_1fr] gap-4">
          <PanelBoundary><CausalNetworkCard /></PanelBoundary>
          <PanelBoundary><ScenarioProjectionsCard /></PanelBoundary>
          <PanelBoundary><DataSourceHealthCard sourceHealth={sourceHealth} /></PanelBoundary>
        </div>

        <PanelBoundary><ParallelCoordinatesChart /></PanelBoundary>
      </div>
    </AICISLayout>
  );
}
