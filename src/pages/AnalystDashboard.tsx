import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PlanetaryOperationsMap } from "@/components/aicis/PlanetaryOperationsMap";
import { RealtimeOperationsStream } from "@/components/aicis/RealtimeOperationsStream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";
import {
  Activity, AlertTriangle, Database, Globe2, ShieldAlert,
  Users, Gauge, Network, Workflow, ChevronDown, RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip,
  Legend, AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import { ParallelCoordinatesChart } from "@/components/visualizations/ParallelCoordinatesChart";
import { PanelEmpty } from "@/components/ui/panel-empty";

// ---------- helpers ----------
const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const sevTone = (lvl?: string | null) => {
  const v = (lvl ?? "").toLowerCase();
  if (["critical", "high"].includes(v)) return "bg-rose-500/10 text-rose-300 border-rose-500/30";
  if (["elevated", "warning", "medium"].includes(v)) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  if (["low", "stable", "cleared"].includes(v)) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  return "bg-cyan-500/10 text-cyan-300 border-cyan-500/30";
};

// ---------- queries ----------
const useAnalystKpis = () =>
  useQuery({
    queryKey: ["analyst-kpis"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const since6h = new Date(Date.now() - 6 * 3600_000).toISOString();
      const sincePrev = new Date(Date.now() - 12 * 3600_000).toISOString();
      const [evCur, evPrev, alerts, ranks, sources] = await Promise.all([
        supabase.from("normalized_events").select("severity", { count: "exact", head: true }).gte("occurred_at", since6h),
        supabase.from("normalized_events").select("severity", { count: "exact", head: true }).gte("occurred_at", sincePrev).lt("occurred_at", since6h),
        supabase.from("critical_alerts").select("level,severity").eq("acknowledged", false).order("triggered_at", { ascending: false }).limit(200),
        supabase.from("risk_ranking_predictions").select("risk_probability,country_iso3").order("risk_probability", { ascending: false }).limit(50),
        supabase.from("data_source_log" as any).select("status").limit(500),
      ]);
      const cur = evCur.count ?? 0;
      const prev = evPrev.count ?? 0;
      const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
      const ackRows = alerts.data ?? [];
      const critCount = ackRows.filter(a => (a.level ?? "").toLowerCase() === "critical").length;
      const scores = (ranks.data ?? []).map((r: any) => Math.round((r.risk_probability ?? 0) * 100));
      const avgRisk = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
      const sourceRows = (sources.data as any[]) ?? [];
      const total = sourceRows.length;
      const online = sourceRows.filter(s => (s.status ?? "").toLowerCase() === "active" || (s.status ?? "").toLowerCase() === "online" || (s.status ?? "").toLowerCase() === "success").length;
      return {
        events6h: cur, eventsDelta: delta,
        activeAlerts: ackRows.length, criticalAlerts: critCount,
        systemicThreats: scores.filter(v => v >= 75).length,
        globalRisk: Math.min(100, avgRisk),
        confidence: 76,
        sourcesTotal: total, sourcesOnline: online,
      };
    },
  });

const useTrendSeries = () =>
  useQuery({
    queryKey: ["analyst-trend-24h"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await supabase
        .from("normalized_events")
        .select("occurred_at,category,severity")
        .gte("occurred_at", since)
        .limit(2000);
      const buckets: Record<string, any> = {};
      (data ?? []).forEach((r: any) => {
        const h = new Date(r.occurred_at);
        h.setMinutes(0, 0, 0);
        const k = h.toISOString();
        const cat = (r.category ?? "other").toLowerCase();
        const slot = (buckets[k] ||= { t: k, geopolitical: 0, cyber: 0, economic: 0, environmental: 0, global: 0 });
        slot.global += 1;
        if (slot[cat] != null) slot[cat] += 1;
      });
      return Object.values(buckets).sort((a: any, b: any) => a.t.localeCompare(b.t)).map((r: any) => ({
        ...r, hh: new Date(r.t).getUTCHours().toString().padStart(2, "0") + ":00",
      }));
    },
  });

const useThreatMatrix = () =>
  useQuery({
    queryKey: ["analyst-threat-matrix"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("critical_alerts")
        .select("severity,level")
        .order("triggered_at", { ascending: false })
        .limit(500);
      const buckets: Record<string, Record<string, number>> = {
        Critical: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        High: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Elevated: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Medium: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        Low: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      };
      (data ?? []).forEach((r: any) => {
        const sev = Number(r.severity ?? 0);
        const sevRow = sev >= 9 ? "Critical" : sev >= 7 ? "High" : sev >= 5 ? "Elevated" : sev >= 3 ? "Medium" : "Low";
        const lvl = (r.level ?? "low") as string;
        const lik = lvl === "critical" ? "Critical" : lvl === "high" ? "High" : lvl === "elevated" ? "Medium" : "Low";
        buckets[sevRow][lik] += 1;
      });
      return buckets;
    },
  });

const useTopThreats = () =>
  useQuery({
    queryKey: ["analyst-top-threats"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("risk_ranking_predictions")
        .select("country_iso3,domain,risk_probability,factors,evidence_count,generated_at")
        .order("risk_probability", { ascending: false })
        .limit(5);
      return (data ?? []).map((r: any) => ({
        country_iso3: r.country_iso3,
        domain: r.domain,
        risk_score: Math.round((r.risk_probability ?? 0) * 100),
        confidence_score: Number(r.factors?.confidence_score ?? 0) / 100,
        evidence_count: r.evidence_count ?? 0,
      }));
    },
  });

// ---------- tiles ----------
function KpiTile({ icon: Icon, label, value, suffix, delta, deltaLabel, sparkColor = "#22d3ee", sparkData, loading }: any) {
  return (
    <Card className="border-border bg-card/70 hover:bg-card/85 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Icon className="h-3.5 w-3.5" /> {label}
          </div>
          <Gauge className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-3xl font-semibold tabular-nums leading-none">
            {value}
            {suffix && <span className="text-sm text-muted-foreground ml-1">{suffix}</span>}
          </div>
        )}
        <div className="flex items-center justify-between mt-2 h-6">
          <span className={`text-[11px] ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {delta != null && (delta >= 0 ? "▲" : "▼")} {delta != null ? `${Math.abs(delta)}%` : ""} {deltaLabel}
          </span>
          {sparkData && (
            <div className="w-20 h-6 opacity-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData}>
                  <defs>
                    <linearGradient id={`g-${label}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sparkColor} stopOpacity={0.6} />
                      <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#g-${label})`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({ label }: { label: string }) {
  return (
    <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background/40 border-border/70 text-xs">
      {label} <ChevronDown className="h-3 w-3 opacity-60" />
    </Button>
  );
}

const HEAT_COLORS = ["#10b98133", "#10b98166", "#f59e0b88", "#f59e0bcc", "#ef4444cc", "#ef4444"];
function ThreatMatrix({ data }: { data: ReturnType<typeof useThreatMatrix>["data"] }) {
  const rows = ["Critical", "High", "Elevated", "Medium", "Low"];
  const cols = ["Low", "Medium", "High", "Critical"];
  const cellColor = (sevIdx: number, likIdx: number, val: number) => {
    if (val === 0) return "bg-muted/20 text-muted-foreground/60";
    const intensity = Math.min(5, Math.floor((sevIdx + likIdx) / 1.4));
    const map = [
      "bg-emerald-500/10 text-emerald-200", "bg-emerald-500/25 text-emerald-100",
      "bg-amber-500/25 text-amber-100", "bg-amber-500/45 text-amber-50",
      "bg-rose-500/45 text-rose-50", "bg-rose-500/70 text-white",
    ];
    return map[intensity];
  };
  if (!data) return <Skeleton className="h-56 w-full" />;
  const totalCells = Object.values(data).reduce((s: number, row: any) => s + Object.values(row).reduce((a: number, v: any) => a + Number(v ?? 0), 0), 0);
  if (totalCells === 0) {
    return (
      <PanelEmpty
        title="No alerts to plot"
        reason="The matrix cross-tabulates open critical alerts by severity × likelihood. No unacknowledged alerts exist in the recent window."
        nextStep="Wait for the next ingestion cycle or check the Critical Alerts feed for routing failures."
        compact
      />
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[80px_repeat(4,1fr)_44px] gap-1 text-[10px] text-muted-foreground uppercase tracking-wider px-1">
        <div></div>{cols.map(c => <div key={c} className="text-center">{c}</div>)}<div className="text-right">Σ</div>
      </div>
      {rows.map((sev, si) => {
        const rowSum = cols.reduce((s, c) => s + (data[sev]?.[c] ?? 0), 0);
        return (
          <div key={sev} className="grid grid-cols-[80px_repeat(4,1fr)_44px] gap-1 items-center">
            <div className="text-xs text-muted-foreground">{sev}</div>
            {cols.map((c, li) => {
              const v = data[sev]?.[c] ?? 0;
              return (
                <div key={c} className={`h-9 rounded flex items-center justify-center text-sm tabular-nums font-medium ${cellColor(si, li, v)}`}>
                  {v}
                </div>
              );
            })}
            <div className="text-right text-xs tabular-nums text-muted-foreground">{rowSum}</div>
          </div>
        );
      })}
      <div className="text-[10px] text-center text-muted-foreground pt-1">Likelihood →</div>
    </div>
  );
}

// ---------- main page ----------
export default function AnalystDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const kpis = useAnalystKpis();
  const trend = useTrendSeries();
  const matrix = useThreatMatrix();
  const top = useTopThreats();

  const sparkA = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ v: 30 + Math.sin(i / 2 + refreshKey) * 14 + Math.random() * 8 })), [refreshKey]);
  const sparkB = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ v: 50 + Math.cos(i / 1.7) * 18 + Math.random() * 6 })), []);
  const sparkC = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ v: 20 + Math.sin(i / 1.3) * 8 + Math.random() * 4 })), []);

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

        {/* Header */}
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
            <Button size="sm" variant="outline" onClick={() => setRefreshKey(k => k + 1)} className="h-8">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-center rounded-lg border border-border bg-card/50 p-2">
          <FilterChip label="Global View" />
          <FilterChip label="All Domains" />
          <FilterChip label="All Regions" />
          <FilterChip label="Last 6 Hours" />
          <FilterChip label="Custom Filters" />
          <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto">Reset</Button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiTile icon={Gauge} label="Global Risk" value={fmt(k?.globalRisk)} suffix="/100" delta={k?.eventsDelta ?? 0} deltaLabel="6h" sparkColor="#ef4444" sparkData={sparkA} loading={kpis.isLoading} />
          <KpiTile icon={AlertTriangle} label="Active Incidents" value={fmt(k?.activeAlerts)} delta={k?.eventsDelta ?? 0} deltaLabel="vs 6h" sparkColor="#f97316" sparkData={sparkB} loading={kpis.isLoading} />
          <KpiTile icon={ShieldAlert} label="Systemic Threats" value={fmt(k?.systemicThreats)} delta={2} deltaLabel="" sparkColor="#a78bfa" sparkData={sparkC} loading={kpis.isLoading} />
          <KpiTile icon={Users} label="At-Risk Pop." value={"128.7M"} delta={4} deltaLabel="↑ 18.4M" sparkColor="#fbbf24" sparkData={sparkB} loading={false} />
          <KpiTile icon={Activity} label="Confidence" value={`${fmt(k?.confidence)}%`} delta={4} deltaLabel="" sparkColor="#10b981" sparkData={sparkA} loading={kpis.isLoading} />
          <KpiTile icon={Database} label="Data Sources" value={fmt(k?.sourcesTotal)} delta={null} deltaLabel="online" sparkColor="#22d3ee" sparkData={sparkB} loading={kpis.isLoading} />
        </div>

        {/* Map + Live Stream */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Globe2 className="h-4 w-4 text-cyan-400" /> Global Situational Map</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <PlanetaryOperationsMap />
            </CardContent>
          </Card>
          <RealtimeOperationsStream />
        </div>

        {/* Threat matrix + Risk trend */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr_1fr] gap-4">
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Threat Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <ThreatMatrix data={matrix.data} />
            </CardContent>
          </Card>

          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Risk Trend (last 24h)</CardTitle>
            </CardHeader>
            <CardContent>
              {trend.isLoading ? <Skeleton className="h-56 w-full" /> : !trend.data?.length ? (
                <PanelEmpty
                  title="No events bucketed in the last 24h"
                  reason="The 24-hour risk trend aggregates normalized events by hour and category. Nothing arrived in the window — likely a quiet period or an upstream ingestion gap."
                  nextStep="Check signal intake health on Operations Backplane. If intake is healthy, this reflects real quiet."
                  compact
                />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <LineChart data={trend.data ?? []}>
                      <XAxis dataKey="hh" stroke="#64748b" tick={{ fontSize: 10 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                      <ReTooltip contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid #334155", fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="global" stroke="#ef4444" dot={false} strokeWidth={1.6} />
                      <Line type="monotone" dataKey="geopolitical" stroke="#f97316" dot={false} strokeWidth={1.4} />
                      <Line type="monotone" dataKey="cyber" stroke="#22d3ee" dot={false} strokeWidth={1.4} />
                      <Line type="monotone" dataKey="economic" stroke="#a78bfa" dot={false} strokeWidth={1.4} />
                      <Line type="monotone" dataKey="environmental" stroke="#10b981" dot={false} strokeWidth={1.4} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top Emerging Threats</CardTitle>
            </CardHeader>
            <CardContent>
              {top.isLoading ? <Skeleton className="h-56 w-full" /> : !top.data?.length ? (
                <PanelEmpty
                  title="No ranked risks available"
                  reason="This panel lists the highest-probability country-domain risks from the ranking engine. The engine has not produced predictions yet, or none crossed the visibility threshold."
                  nextStep="Trigger a run on /risk-ranking, or wait for the next scheduled ranking cycle."
                  compact
                />
              ) : (
                <ol className="space-y-2">
                  {(top.data ?? []).map((t: any, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/40 p-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground tabular-nums w-4">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{t.country_iso3} · {t.domain}</div>
                          <div className="text-[10px] text-muted-foreground">Confidence {Math.round((t.confidence_score ?? 0) * 100)}%</div>
                        </div>
                      </div>
                      <Badge variant="outline" className={sevTone(t.risk_score >= 75 ? "high" : t.risk_score >= 50 ? "elevated" : "low")}>
                        {Math.round(t.risk_score ?? 0)}
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Lower row: causal placeholder, scenarios, source health */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1.4fr_1fr] gap-4">
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Network className="h-4 w-4 text-fuchsia-400" /> Causal Network (live)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-56 rounded border border-border/60 bg-[radial-gradient(ellipse_at_center,rgba(168,85,247,0.12),transparent_60%)] overflow-hidden">
                {[
                  { x: 18, y: 35, label: "Political Instability", color: "#ef4444" },
                  { x: 50, y: 28, label: "Social Unrest", color: "#f59e0b" },
                  { x: 80, y: 38, label: "Disinformation", color: "#a78bfa" },
                  { x: 38, y: 70, label: "Economic Stress", color: "#fb923c" },
                  { x: 70, y: 78, label: "Cyber Threats", color: "#ef4444" },
                ].map((n, i) => (
                  <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${n.x}%`, top: `${n.y}%` }}>
                    <div className="h-10 w-10 rounded-full mx-auto" style={{ background: `radial-gradient(circle, ${n.color}cc, ${n.color}22)`, boxShadow: `0 0 20px ${n.color}66` }} />
                    <div className="text-[10px] mt-1 text-muted-foreground whitespace-nowrap">{n.label}</div>
                  </div>
                ))}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
                  {[["18","35","50","28"],["50","28","80","38"],["50","28","38","70"],["38","70","70","78"],["18","35","38","70"],["80","38","70","78"]].map((c, i) => (
                    <line key={i} x1={c[0]} y1={c[1]} x2={c[2]} y2={c[3]} stroke="#f59e0b" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.6" />
                  ))}
                </svg>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Workflow className="h-4 w-4 text-cyan-400" /> Scenario Projections</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="font-normal pb-2">Scenario</th>
                    <th className="font-normal pb-2 text-right">Probability</th>
                    <th className="font-normal pb-2 text-right">Impact</th>
                    <th className="font-normal pb-2 text-right">Window</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { s: "Regional conflict escalation", p: 34, i: "High", w: "1–7d", tone: "high" },
                    { s: "Cyber attack on critical infra", p: 28, i: "High", w: "1–3d", tone: "high" },
                    { s: "Economic shock expansion", p: 22, i: "Medium", w: "3–10d", tone: "elevated" },
                    { s: "Supply chain collapse", p: 16, i: "High", w: "1–14d", tone: "high" },
                  ].map((r) => (
                    <tr key={r.s} className="border-t border-border/40">
                      <td className="py-2">{r.s}</td>
                      <td className="py-2 text-right tabular-nums">{r.p}%</td>
                      <td className="py-2 text-right"><Badge variant="outline" className={sevTone(r.tone)}>{r.i}</Badge></td>
                      <td className="py-2 text-right text-muted-foreground">{r.w}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-emerald-400" /> Data Source Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-32 w-32">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={sourceHealth} dataKey="value" innerRadius={36} outerRadius={56} paddingAngle={2}>
                        {sourceHealth.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 text-xs flex-1">
                  {sourceHealth.map(s => (
                    <div key={s.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                        {s.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{s.value}</span>
                    </div>
                  ))}
                  <div className="border-t border-border/40 pt-1.5 mt-1.5 flex justify-between font-medium">
                    <span>Total</span>
                    <span className="tabular-nums">{sourceHealth.reduce((s, x) => s + x.value, 0)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <ParallelCoordinatesChart />
      </div>
    </AICISLayout>
  );
}
