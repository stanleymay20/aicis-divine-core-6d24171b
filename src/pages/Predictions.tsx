import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, RefreshCw, Brain, Calendar, AlertTriangle, TrendingUp, Activity, Sigma } from "lucide-react";
import { cn } from "@/lib/utils";

const HORIZONS = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

interface MLRow {
  id: string;
  country_iso3: string;
  domain: string;
  horizon_days: number;
  risk_probability: number;
  raw_score: number | null;
  calibrated_score: number | null;
  prediction_interval_lower: number | null;
  prediction_interval_upper: number | null;
  model_version: string;
  audit_hash: string | null;
}

const sevClass = (p: number) =>
  p >= 0.7 ? "bg-destructive/15 text-destructive border-destructive/30" :
  p >= 0.5 ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
             "bg-primary/10 text-primary border-primary/20";

export default function PredictionsPage() {
  const qc = useQueryClient();
  const [horizon, setHorizon] = useState("7");
  const [domainFilter, setDomainFilter] = useState<string>("all");

  const list = useQuery({
    queryKey: ["ml-predictions", horizon],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ml-inference", {
        body: { mode: "list", horizon: Number(horizon), top_n: 100 },
      });
      if (error) throw error;
      return data as { rows: MLRow[]; generated_at?: string };
    },
    staleTime: 30_000,
  });

  const infer = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ml-inference", {
        body: { mode: "infer", horizon: Number(horizon) },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Generated ${d?.rows_inserted ?? 0} predictions · model ${d?.model_version}`);
      qc.invalidateQueries({ queryKey: ["ml-predictions"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const allRows = (list.data?.rows ?? []).filter(r => Number(r.horizon_days) === Number(horizon));

  const domains = useMemo(() => {
    const s = new Set<string>();
    allRows.forEach(r => s.add(r.domain));
    return Array.from(s).sort();
  }, [allRows]);

  const rows = domainFilter === "all" ? allRows : allRows.filter(r => r.domain === domainFilter);

  const stats = useMemo(() => {
    const probs = allRows.map(r => Number(r.calibrated_score ?? r.risk_probability));
    const critical = probs.filter(p => p >= 0.7).length;
    const high = probs.filter(p => p >= 0.5 && p < 0.7).length;
    const watch = probs.filter(p => p < 0.5).length;
    const avg = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : 0;
    const model = allRows[0]?.model_version ?? "—";
    return { total: probs.length, critical, high, watch, avg, model };
  }, [allRows]);

  const generatedAt = list.data?.generated_at ? new Date(list.data.generated_at) : null;
  const ageHours = generatedAt ? (Date.now() - generatedAt.getTime()) / 3_600_000 : 999;
  const isStale = ageHours > 24;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <PanelBoundary>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" /> Risk Predictions
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Calibrated probabilities with 95% prediction intervals. SHA-256 audit hash per row · capped at 95% confidence.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider border rounded px-2 py-1",
              isStale ? "border-amber-500/30 text-amber-500" : "border-border text-muted-foreground"
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", isStale ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
              {generatedAt ? (isStale ? `Stale ${Math.round(ageHours)}h` : `Updated ${Math.round(ageHours)}h ago`) : "Never run"}
            </span>
            <Button onClick={() => infer.mutate()} disabled={infer.isPending} size="sm" className="gap-2 h-8">
              {infer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run inference ({horizon}d)
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Sigma className="h-3 w-3" /> Predictions
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1">{stats.total}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-3 w-3" /> Critical ≥70%
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-destructive mt-1">{stats.critical}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> High 50–70%
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-500 mt-1">{stats.high}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Activity className="h-3 w-3" /> Avg probability
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-primary mt-1">{(stats.avg * 100).toFixed(0)}%</div>
          </Card>
          <Card className="p-3 col-span-2 sm:col-span-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Model</div>
            <div className="text-sm font-mono font-semibold mt-1 truncate" title={stats.model}>{stats.model}</div>
          </Card>
        </div>

        {/* Severity distribution bar */}
        {stats.total > 0 && (
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-destructive" style={{ width: `${(stats.critical / stats.total) * 100}%` }} />
            <div className="bg-amber-500" style={{ width: `${(stats.high / stats.total) * 100}%` }} />
            <div className="bg-primary/60" style={{ width: `${(stats.watch / stats.total) * 100}%` }} />
          </div>
        )}

        <Tabs value={horizon} onValueChange={setHorizon}>
          <TabsList className="bg-muted/50">
            {HORIZONS.map(h => (
              <TabsTrigger key={h.key} value={h.key} className="gap-2 text-xs data-[state=active]:bg-card">
                <Calendar className="h-3.5 w-3.5" /> {h.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {HORIZONS.map(h => (
            <TabsContent key={h.key} value={h.key} className="space-y-3 mt-4">
              {/* Domain filter chips */}
              {domains.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setDomainFilter("all")}
                    className={cn(
                      "text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition",
                      domainFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    All ({allRows.length})
                  </button>
                  {domains.map(d => {
                    const c = allRows.filter(r => r.domain === d).length;
                    return (
                      <button
                        key={d}
                        onClick={() => setDomainFilter(d)}
                        className={cn(
                          "text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition capitalize",
                          domainFilter === d ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {d.replace(/_/g, " ")} ({c})
                      </button>
                    );
                  })}
                </div>
              )}

              <Card className="border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    Top predicted deteriorations · {h.label}
                    {domainFilter !== "all" && <span className="ml-2 text-xs text-muted-foreground capitalize">/ {domainFilter.replace(/_/g, " ")}</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {list.isLoading ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : rows.length === 0 ? (
                    <div className="py-10 text-center space-y-2">
                      <Brain className="h-8 w-8 mx-auto text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        No predictions for {h.label} horizon{domainFilter !== "all" ? ` in ${domainFilter}` : ""}.
                      </p>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => infer.mutate()} disabled={infer.isPending}>
                        Run inference now
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {rows.map((r, i) => {
                        const p = Number(r.calibrated_score ?? r.risk_probability);
                        const lo = Number(r.prediction_interval_lower ?? p);
                        const hi = Number(r.prediction_interval_upper ?? p);
                        return (
                          <div key={r.id} className="px-4 py-2.5 hover:bg-muted/30 transition flex items-center gap-3">
                            <span className="text-[11px] font-mono text-muted-foreground w-8 shrink-0 tabular-nums">#{i + 1}</span>
                            <span className="text-sm font-mono font-semibold w-12 shrink-0">{r.country_iso3}</span>
                            <span className="text-sm capitalize w-24 shrink-0 text-muted-foreground truncate">{r.domain.replace(/_/g, " ")}</span>
                            <div className="flex-1 min-w-0">
                              {/* Inline CI bar */}
                              <div className="relative h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="absolute h-full bg-muted-foreground/30"
                                  style={{ left: `${lo * 100}%`, width: `${Math.max(0, (hi - lo) * 100)}%` }}
                                />
                                <div
                                  className={cn("absolute top-1/2 -translate-y-1/2 h-2 w-2 rounded-full",
                                    p >= 0.7 ? "bg-destructive" : p >= 0.5 ? "bg-amber-500" : "bg-primary"
                                  )}
                                  style={{ left: `calc(${p * 100}% - 4px)` }}
                                />
                              </div>
                              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground mt-1 font-mono tabular-nums">
                                <span>raw {Number(r.raw_score ?? 0).toFixed(2)}</span>
                                <span>·</span>
                                <span>95% CI [{(lo * 100).toFixed(0)}–{(hi * 100).toFixed(0)}%]</span>
                                {r.audit_hash && (
                                  <>
                                    <span>·</span>
                                    <span title={r.audit_hash}>hash {r.audit_hash.slice(0, 8)}…</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <Badge variant="outline" className={`text-[11px] font-mono tabular-nums ${sevClass(p)}`}>
                              {(p * 100).toFixed(0)}%
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </AICISLayout>
  );
}
