import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Play, Activity, BarChart3, RefreshCw, ShieldCheck, Sigma, TrendingUp, Layers } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useMemo } from "react";

const DOMAINS = ["health", "energy", "food", "finance", "governance", "security", "climate", "education", "population"];
const DIRECTIONS = ["down", "up"];

interface SimRow {
  id: string;
  scenario_name: string;
  shock_domain: string;
  shock_iso3: string | null;
  shock_magnitude: number;
  shock_direction: string;
  n_iterations: number;
  p10: number; p50: number; p90: number;
  estimated_global_impact: number;
  confidence: number;
  cascade_depth: number;
  result_distribution: { histogram?: number[]; min?: number; max?: number };
  created_at: string;
}

export default function SimulationPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("Energy shock — baseline");
  const [domain, setDomain] = useState("energy");
  const [iso3, setIso3] = useState("");
  const [magnitude, setMagnitude] = useState(0.2);
  const [direction, setDirection] = useState("down");
  const [iterations, setIterations] = useState(500);
  const [cascadeDepth, setCascadeDepth] = useState(3);

  const list = useQuery({
    queryKey: ["simulation-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-simulation", { body: { mode: "list", limit: 30 } });
      if (error) throw error;
      return data as { rows: SimRow[] };
    },
    staleTime: 15_000,
  });

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-simulation", {
        body: {
          mode: "run", scenario_name: name, domain, iso3: iso3 || null,
          magnitude, direction, n_iterations: iterations, cascade_depth: cascadeDepth,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Simulation complete · p50=${Number(d?.simulation?.p50 ?? 0).toFixed(2)}`);
      qc.invalidateQueries({ queryKey: ["simulation-runs"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const rows = list.data?.rows ?? [];
  const kpis = useMemo(() => {
    if (!rows.length) return null;
    const meanP50 = rows.reduce((s, r) => s + Number(r.p50 ?? 0), 0) / rows.length;
    const maxP90 = rows.reduce((m, r) => Math.max(m, Number(r.p90 ?? 0)), 0);
    const meanIter = Math.round(rows.reduce((s, r) => s + Number(r.n_iterations ?? 0), 0) / rows.length);
    const meanConf = rows.reduce((s, r) => s + Number(r.confidence ?? 0), 0) / rows.length;
    const last = rows[0]?.created_at ? new Date(rows[0].created_at) : null;
    return { meanP50, maxP90, meanIter, meanConf, last };
  }, [rows]);

  const isStale = kpis?.last ? Date.now() - kpis.last.getTime() > 24 * 3600_000 : true;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <PanelBoundary>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> Scenario Simulation Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Monte Carlo what-if modeling. Parameter shocks → cascade across domains → probabilistic distribution (p10/p50/p90).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[11px] font-mono gap-1.5 ${
                isStale
                  ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
                  : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isStale ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
              {kpis?.last ? `Last run ${formatDistanceToNow(kpis.last, { addSuffix: true })}` : "No runs yet"}
            </Badge>
            <Button onClick={() => list.refetch()} disabled={list.isFetching} size="sm" variant="outline" className="gap-2">
              {list.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiTile icon={<Sigma className="h-3.5 w-3.5" />} label="Total runs" value={String(rows.length)} />
          <KpiTile icon={<Activity className="h-3.5 w-3.5" />} label="Mean p50" value={kpis ? kpis.meanP50.toFixed(2) : "—"} tone="primary" />
          <KpiTile icon={<TrendingUp className="h-3.5 w-3.5" />} label="Max p90" value={kpis ? kpis.maxP90.toFixed(2) : "—"} tone="destructive" />
          <KpiTile icon={<Layers className="h-3.5 w-3.5" />} label="Mean iterations" value={kpis ? kpis.meanIter.toLocaleString() : "—"} />
          <KpiTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Mean confidence" value={kpis ? `${(kpis.meanConf * 100).toFixed(0)}%` : "—"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="border-border lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-sm">Scenario parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Scenario name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Domain</Label>
                  <Select value={domain} onValueChange={setDomain}>
                    <SelectTrigger className="h-9 text-sm capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>{DOMAINS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Direction</Label>
                  <Select value={direction} onValueChange={setDirection}>
                    <SelectTrigger className="h-9 text-sm capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>{DIRECTIONS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Country (ISO3 — optional)</Label>
                <Input value={iso3} onChange={(e) => setIso3(e.target.value.toUpperCase().slice(0, 3))} placeholder="leave empty for global" className="h-9 text-sm font-mono uppercase" />
              </div>

              <div>
                <Label className="text-xs flex justify-between">
                  <span>Shock magnitude</span><span className="font-mono">{(magnitude * 100).toFixed(0)}%</span>
                </Label>
                <Slider value={[magnitude]} min={0.05} max={1} step={0.05} onValueChange={(v) => setMagnitude(v[0])} className="mt-2" />
              </div>

              <div>
                <Label className="text-xs flex justify-between">
                  <span>Iterations (Monte Carlo)</span><span className="font-mono">{iterations}</span>
                </Label>
                <Slider value={[iterations]} min={100} max={2000} step={100} onValueChange={(v) => setIterations(v[0])} className="mt-2" />
              </div>

              <div>
                <Label className="text-xs flex justify-between">
                  <span>Cascade depth (hops)</span><span className="font-mono">{cascadeDepth}</span>
                </Label>
                <Slider value={[cascadeDepth]} min={1} max={5} step={1} onValueChange={(v) => setCascadeDepth(v[0])} className="mt-2" />
              </div>

              <Button onClick={() => run.mutate()} disabled={run.isPending} className="w-full gap-2">
                {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run simulation
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Recent simulation runs</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {list.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (list.data?.rows ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No simulations yet. Run one to see distributions.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(list.data?.rows ?? []).map((r) => (
                    <div key={r.id} className="px-4 py-3 hover:bg-muted/30 transition">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{r.scenario_name}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="capitalize font-mono">{r.shock_domain}</span>
                            <span>·</span>
                            <span>{r.shock_iso3 ?? "global"}</span>
                            <span>·</span>
                            <span>shock {(Number(r.shock_magnitude) * 100).toFixed(0)}% {r.shock_direction}</span>
                            <span>·</span>
                            <span>{r.n_iterations} iter</span>
                            <span>·</span>
                            <span>{r.cascade_depth}-hop</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono">
                          <Badge variant="outline" className="bg-muted/40">p10 {Number(r.p10 ?? 0).toFixed(2)}</Badge>
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">p50 {Number(r.p50 ?? 0).toFixed(2)}</Badge>
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">p90 {Number(r.p90 ?? 0).toFixed(2)}</Badge>
                        </div>
                      </div>
                      <Histogram bins={r.result_distribution?.histogram} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AICISLayout>
  );
}

const Histogram = ({ bins }: { bins?: number[] }) => {
  if (!bins || bins.length === 0) return null;
  const max = Math.max(...bins, 1);
  return (
    <div className="flex items-end gap-0.5 h-10 mt-2">
      {bins.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-primary/40 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
          title={`bin ${i}: ${v}`}
        />
      ))}
    </div>
  );
};

const KpiTile = ({
  icon, label, value, tone = "default",
}: { icon: React.ReactNode; label: string; value: string; tone?: "default" | "primary" | "destructive" }) => {
  const valueClass =
    tone === "primary" ? "text-primary" :
    tone === "destructive" ? "text-destructive" : "";
  return (
    <Card className="border-border">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
          {icon} {label}
        </div>
        <div className={`text-lg font-mono font-semibold mt-1 ${valueClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
};
