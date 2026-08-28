import { useMemo, useState } from "react";
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

const DOMAINS = ["health", "energy", "food", "finance", "governance", "security", "climate", "education", "population"];
const DIRECTIONS = ["down", "up"];

interface SimRow {
  id: string;
  scenario_name: string;
  shock_domain: string;
  shock_iso3: string | null;
  shock_magnitude: number;
  shock_direction: string;
  n_iterations: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  simulated_aggregate_impact: number | null;
  confidence: number | null;
  confidence_semantics: string | null;
  cascade_depth: number | null;
  cascade_semantics: string | null;
  simulation_semantics: string | null;
  uncertainty_semantics: string | null;
  baseline_target_count: number | null;
  baseline_excluded_count: number | null;
  baseline_coverage_status: string | null;
  result_distribution: { histogram?: number[]; min?: number | null; max?: number | null } | null;
  created_at: string;
}

function observedNumbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetric(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export default function SimulationPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Energy shock — baseline");
  const [domain, setDomain] = useState("energy");
  const [iso3, setIso3] = useState("");
  const [magnitude, setMagnitude] = useState(0.2);
  const [direction, setDirection] = useState("down");
  const [iterations, setIterations] = useState(500);
  const [repeatedEffectDepth, setRepeatedEffectDepth] = useState(3);

  const list = useQuery({
    queryKey: ["simulation-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-simulation", {
        body: { mode: "list", limit: 30 },
      });
      if (error) throw error;
      return data as { rows: SimRow[] };
    },
    staleTime: 15_000,
  });

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-simulation", {
        body: {
          mode: "run",
          scenario_name: name,
          domain,
          iso3: iso3 || null,
          magnitude,
          direction,
          n_iterations: iterations,
          cascade_depth: repeatedEffectDepth,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const p50 = data?.simulation?.p50;
      toast.success(
        typeof p50 === "number" && Number.isFinite(p50)
          ? `Sensitivity simulation complete · synthetic p50=${p50.toFixed(2)}`
          : "Sensitivity simulation complete",
      );
      queryClient.invalidateQueries({ queryKey: ["simulation-runs"] });
    },
    onError: (error) => toast.error(String(error)),
  });

  const rows = useMemo(() => list.data?.rows ?? [], [list.data?.rows]);
  const kpis = useMemo(() => {
    if (rows.length === 0) return null;
    const p50Values = observedNumbers(rows.map((row) => row.p50));
    const p90Values = observedNumbers(rows.map((row) => row.p90));
    const iterationValues = observedNumbers(rows.map((row) => row.n_iterations));
    const last = rows[0]?.created_at ? new Date(rows[0].created_at) : null;
    return {
      meanP50: mean(p50Values),
      maxP90: p90Values.length > 0 ? Math.max(...p90Values) : null,
      meanIterations: mean(iterationValues),
      latestBaselineTargets: rows[0]?.baseline_target_count ?? null,
      last,
    };
  }, [rows]);

  const isStale = kpis?.last ? Date.now() - kpis.last.getTime() > 24 * 3_600_000 : true;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <PanelBoundary>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" /> Scenario Sensitivity Engine
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                Counterfactual sensitivity modeling with declared synthetic noise assumptions. p10/p50/p90 describe the simulated draw distribution — not real-world prediction intervals or forecast probabilities.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px] gap-1.5 bg-sky-500/10 text-sky-700 border-sky-500/30">
                <ShieldCheck className="h-3 w-3" /> Sensitivity · not forecast
              </Badge>
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

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiTile icon={<Sigma className="h-3.5 w-3.5" />} label="Total runs" value={String(rows.length)} />
            <KpiTile icon={<Activity className="h-3.5 w-3.5" />} label="Mean synthetic p50" value={formatMetric(kpis?.meanP50)} tone="primary" />
            <KpiTile icon={<TrendingUp className="h-3.5 w-3.5" />} label="Max synthetic p90" value={formatMetric(kpis?.maxP90)} tone="destructive" />
            <KpiTile icon={<Layers className="h-3.5 w-3.5" />} label="Mean draws" value={kpis?.meanIterations === null || kpis?.meanIterations === undefined ? "—" : Math.round(kpis.meanIterations).toLocaleString()} />
            <KpiTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Latest baseline targets" value={kpis?.latestBaselineTargets === null || kpis?.latestBaselineTargets === undefined ? "—" : String(kpis.latestBaselineTargets)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="border-border lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm">Scenario parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Scenario name</Label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} className="h-9 text-sm" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Domain</Label>
                    <Select value={domain} onValueChange={setDomain}>
                      <SelectTrigger className="h-9 text-sm capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>{DOMAINS.map((item) => <SelectItem key={item} value={item} className="capitalize">{item}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Direction</Label>
                    <Select value={direction} onValueChange={setDirection}>
                      <SelectTrigger className="h-9 text-sm capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>{DIRECTIONS.map((item) => <SelectItem key={item} value={item} className="capitalize">{item}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Country (ISO3 — optional)</Label>
                  <Input value={iso3} onChange={(event) => setIso3(event.target.value.toUpperCase().slice(0, 3))} placeholder="leave empty for available domain baseline" className="h-9 text-sm font-mono uppercase" />
                </div>

                <div>
                  <Label className="text-xs flex justify-between">
                    <span>Operator shock magnitude</span><span className="font-mono">{(magnitude * 100).toFixed(0)}%</span>
                  </Label>
                  <Slider value={[magnitude]} min={0.05} max={1} step={0.05} onValueChange={(value) => setMagnitude(value[0])} className="mt-2" />
                </div>

                <div>
                  <Label className="text-xs flex justify-between">
                    <span>Synthetic draws</span><span className="font-mono">{iterations}</span>
                  </Label>
                  <Slider value={[iterations]} min={100} max={2000} step={100} onValueChange={(value) => setIterations(value[0])} className="mt-2" />
                </div>

                <div>
                  <Label className="text-xs flex justify-between">
                    <span>Repeated-effect depth</span><span className="font-mono">{repeatedEffectDepth}</span>
                  </Label>
                  <Slider value={[repeatedEffectDepth]} min={1} max={5} step={1} onValueChange={(value) => setRepeatedEffectDepth(value[0])} className="mt-2" />
                  <p className="text-[10px] text-muted-foreground mt-1">This is geometric dampening depth, not a graph or causal hop count.</p>
                </div>

                <Button onClick={() => run.mutate()} disabled={run.isPending} className="w-full gap-2">
                  {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run sensitivity simulation
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Recent sensitivity runs</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {list.isLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No simulations yet. Run one to inspect the declared synthetic distribution.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {rows.map((row) => (
                      <div key={row.id} className="px-4 py-3 hover:bg-muted/30 transition">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{row.scenario_name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                              <span className="capitalize font-mono">{row.shock_domain}</span>
                              <span>·</span>
                              <span>{row.shock_iso3 ?? "available domain baseline"}</span>
                              <span>·</span>
                              <span>shock {(Number(row.shock_magnitude) * 100).toFixed(0)}% {row.shock_direction}</span>
                              <span>·</span>
                              <span>{row.n_iterations ?? "—"} draws</span>
                              <span>·</span>
                              <span>depth {row.cascade_depth ?? "—"}</span>
                              <span>·</span>
                              <span>{row.baseline_target_count ?? "—"} baseline targets</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {row.simulation_semantics ?? "Legacy simulation semantics unverified"}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] font-mono">
                            <Badge variant="outline" className="bg-muted/40">sim p10 {formatMetric(row.p10)}</Badge>
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">sim p50 {formatMetric(row.p50)}</Badge>
                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">sim p90 {formatMetric(row.p90)}</Badge>
                          </div>
                        </div>
                        <Histogram bins={row.result_distribution?.histogram} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </PanelBoundary>
      </div>
    </AICISLayout>
  );
}

const Histogram = ({ bins }: { bins?: number[] }) => {
  if (!bins || bins.length === 0) return null;
  const max = Math.max(...bins, 1);
  return (
    <div className="flex items-end gap-0.5 h-10 mt-2">
      {bins.map((value, index) => (
        <div
          key={index}
          className="flex-1 bg-primary/40 rounded-sm"
          style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? 2 : 0 }}
          title={`synthetic bin ${index}: ${value}`}
        />
      ))}
    </div>
  );
};

const KpiTile = ({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "primary" | "destructive";
}) => {
  const valueClass = tone === "primary"
    ? "text-primary"
    : tone === "destructive"
    ? "text-destructive"
    : "";
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
