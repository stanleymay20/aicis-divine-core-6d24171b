import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Brain, RefreshCw, Loader2, ShieldCheck, Target, Activity, AlertTriangle,
} from "lucide-react";

interface PerfRow {
  id: string;
  model_version: string;
  domain: string;
  sample_size: number;
  accuracy: number | null;
  brier_score: number | null;
  calibration_error: number | null;
  bias: number | null;
  trust_score: number | null;
  surprise_rate: number | null;
  positive_rate_actual: number | null;
  positive_rate_predicted: number | null;
  computed_at: string;
}

interface TrustRow {
  domain: string;
  trust_score: number;
  brier_score: number | null;
  accuracy: number | null;
  calibration_error: number | null;
  sample_size: number;
  model_version: string | null;
  updated_at: string;
}

interface RealRow {
  id: string;
  country_iso3: string;
  domain: string;
  predicted_at: string;
  realized_at: string;
  predicted_probability: number;
  actual_label: number;
  error: number;
  brier_score: number;
  surprise: boolean;
}

const trustClass = (t: number) =>
  t >= 0.75 ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" :
  t >= 0.5  ? "bg-primary/10 text-primary border-primary/20" :
  t >= 0.3  ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
              "bg-destructive/15 text-destructive border-destructive/30";

const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `${(Number(n) * 100).toFixed(digits)}%`;

const num = (n: number | null | undefined, digits = 3) =>
  n == null ? "—" : Number(n).toFixed(digits);

export default function LearningLoop() {
  const qc = useQueryClient();

  const trust = useQuery({
    queryKey: ["domain-trust"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("learn-from-outcomes", { body: { mode: "trust" } });
      if (error) throw error;
      return data as { rows: TrustRow[] };
    },
    staleTime: 60_000,
  });

  const perf = useQuery({
    queryKey: ["model-perf"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("learn-from-outcomes", { body: { mode: "performance", limit: 100 } });
      if (error) throw error;
      return data as { rows: PerfRow[] };
    },
    staleTime: 60_000,
  });

  const reals = useQuery({
    queryKey: ["realizations"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("learn-from-outcomes", { body: { mode: "realizations", limit: 100 } });
      if (error) throw error;
      return data as { rows: RealRow[] };
    },
    staleTime: 60_000,
  });

  const realize = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("learn-from-outcomes", { body: { mode: "realize", horizon_days: 7 } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Realized ${d?.realized ?? 0} predictions · ${d?.perf_rows ?? 0} domains scored`);
      qc.invalidateQueries({ queryKey: ["domain-trust"] });
      qc.invalidateQueries({ queryKey: ["model-perf"] });
      qc.invalidateQueries({ queryKey: ["realizations"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  // Aggregate KPIs
  const kpis = useMemo(() => {
    const r = reals.data?.rows ?? [];
    if (!r.length) return null;
    const brier = r.reduce((s, x) => s + Number(x.brier_score), 0) / r.length;
    const accuracy = r.filter(x =>
      (Number(x.predicted_probability) >= 0.5 && x.actual_label === 1) ||
      (Number(x.predicted_probability) < 0.5  && x.actual_label === 0)
    ).length / r.length;
    const surprises = r.filter(x => x.surprise).length;
    const trustScores = (trust.data?.rows ?? []).map(t => Number(t.trust_score));
    const meanTrust = trustScores.length ? trustScores.reduce((a,b)=>a+b,0) / trustScores.length : 0;
    return { brier, accuracy, surprises, total: r.length, meanTrust };
  }, [reals.data, trust.data]);

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <PanelBoundary>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Learning Loop · SGI Core
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Closes the prediction → outcome → calibration cycle. Past risk-ranking predictions are
              compared with actual deterioration after 7 days. Per-domain trust scores feed back into
              future predictions. This is the foundation of the self-improving intelligence loop.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {kpis && (
              <Badge variant="outline" className="text-[11px] font-mono gap-1.5 bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {kpis.total} realized · {kpis.surprises} surprises
              </Badge>
            )}
            <Button onClick={() => realize.mutate()} disabled={realize.isPending} size="sm" className="gap-2">
              {realize.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Realize predictions now
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Mean trust" value={pct(kpis?.meanTrust, 1)} />
          <Kpi icon={<Target className="h-3.5 w-3.5" />} label="Accuracy" value={pct(kpis?.accuracy, 1)} />
          <Kpi icon={<Activity className="h-3.5 w-3.5" />} label="Brier" value={num(kpis?.brier ?? null, 3)} />
          <Kpi icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Surprises" value={kpis ? `${kpis.surprises}/${kpis.total}` : "—"} />
          <Kpi icon={<Brain className="h-3.5 w-3.5" />} label="Domains tracked" value={String(trust.data?.rows?.length ?? 0)} />
        </div>

        <Tabs defaultValue="trust">
          <TabsList>
            <TabsTrigger value="trust" className="gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Domain trust</TabsTrigger>
            <TabsTrigger value="perf"  className="gap-2"><Activity className="h-3.5 w-3.5" /> Performance log</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2"><Target className="h-3.5 w-3.5" /> Realized predictions</TabsTrigger>
          </TabsList>

          {/* Trust */}
          <TabsContent value="trust" className="space-y-3">
            <Card className="border-border">
              <CardHeader><CardTitle className="text-sm">Per-domain model trust</CardTitle></CardHeader>
              <CardContent className="p-0">
                {trust.isLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : !trust.data?.rows?.length ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    No trust scores yet. Click <span className="font-mono">Realize predictions now</span> after some predictions have aged 7 days.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {trust.data.rows.map(t => (
                      <div key={t.domain} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-sm capitalize w-24 shrink-0">{t.domain}</span>
                        <div className="flex-1 min-w-0 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                          <span>Acc {pct(t.accuracy, 1)}</span>
                          <span>Brier {num(t.brier_score)}</span>
                          <span>Calib err {pct(t.calibration_error, 1)}</span>
                          <span>n={t.sample_size}</span>
                          <span className="font-mono">{t.model_version ?? "—"}</span>
                        </div>
                        <Badge variant="outline" className={`text-[11px] font-mono ${trustClass(Number(t.trust_score))}`}>
                          Trust {pct(t.trust_score, 0)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Perf */}
          <TabsContent value="perf" className="space-y-3">
            <Card className="border-border">
              <CardHeader><CardTitle className="text-sm">Performance log (last 100 evaluations)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {perf.isLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : !perf.data?.rows?.length ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">No performance evaluations recorded yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2">When</th>
                          <th className="text-left px-3 py-2">Domain</th>
                          <th className="text-left px-3 py-2">Model</th>
                          <th className="text-right px-3 py-2">n</th>
                          <th className="text-right px-3 py-2">Acc</th>
                          <th className="text-right px-3 py-2">Brier</th>
                          <th className="text-right px-3 py-2">Calib err</th>
                          <th className="text-right px-3 py-2">Bias</th>
                          <th className="text-right px-3 py-2">Trust</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {perf.data.rows.map(p => (
                          <tr key={p.id} className="hover:bg-muted/30">
                            <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px]">{new Date(p.computed_at).toLocaleString()}</td>
                            <td className="px-3 py-1.5 capitalize">{p.domain}</td>
                            <td className="px-3 py-1.5 font-mono text-[11px]">{p.model_version}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{p.sample_size}</td>
                            <td className="px-3 py-1.5 text-right">{pct(p.accuracy, 1)}</td>
                            <td className="px-3 py-1.5 text-right">{num(p.brier_score)}</td>
                            <td className="px-3 py-1.5 text-right">{pct(p.calibration_error, 1)}</td>
                            <td className="px-3 py-1.5 text-right">{num(p.bias)}</td>
                            <td className="px-3 py-1.5 text-right">
                              <Badge variant="outline" className={`text-[10px] font-mono ${trustClass(Number(p.trust_score ?? 0))}`}>
                                {pct(p.trust_score, 0)}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit */}
          <TabsContent value="audit" className="space-y-3">
            <Card className="border-border">
              <CardHeader><CardTitle className="text-sm">Realized predictions (recent 100)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {reals.isLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : !reals.data?.rows?.length ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    No realized predictions yet. Predictions need to age 7 days before they can be evaluated.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2">Realized</th>
                          <th className="text-left px-3 py-2">Country</th>
                          <th className="text-left px-3 py-2">Domain</th>
                          <th className="text-right px-3 py-2">Predicted</th>
                          <th className="text-right px-3 py-2">Actual</th>
                          <th className="text-right px-3 py-2">Error</th>
                          <th className="text-right px-3 py-2">Brier</th>
                          <th className="text-center px-3 py-2">Surprise</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {reals.data.rows.map(r => (
                          <tr key={r.id} className="hover:bg-muted/30">
                            <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px]">{new Date(r.realized_at).toLocaleString()}</td>
                            <td className="px-3 py-1.5 font-mono">{r.country_iso3}</td>
                            <td className="px-3 py-1.5 capitalize">{r.domain}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{(Number(r.predicted_probability)*100).toFixed(0)}%</td>
                            <td className="px-3 py-1.5 text-right font-mono">{r.actual_label === 1 ? "↓ deteriorated" : "→ stable"}</td>
                            <td className={`px-3 py-1.5 text-right font-mono ${Math.abs(Number(r.error)) > 0.5 ? "text-destructive" : ""}`}>{num(r.error, 2)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{num(r.brier_score)}</td>
                            <td className="px-3 py-1.5 text-center">
                              {r.surprise && <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/30">⚠</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </PanelBoundary>
      </div>
    </AICISLayout>
  );
}

const Kpi = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <Card className="border-border">
    <CardContent className="p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="text-lg font-mono font-semibold mt-1">{value}</div>
    </CardContent>
  </Card>
);
