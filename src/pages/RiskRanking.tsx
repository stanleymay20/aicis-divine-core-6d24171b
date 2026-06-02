import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Flame, RefreshCw, Loader2, Search, TrendingDown, Activity, Zap, Target } from "lucide-react";
import { RecommendedActionsPanel } from "@/components/risk-ranking/RecommendedActionsPanel";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { PanelSkeleton } from "@/components/ui/panel-skeleton";

interface Row {
  id: string;
  country_iso3: string;
  domain: string;
  risk_probability: number;
  rank_position: number;
  factors: any;
}

const DOMAINS = ["all", "health", "energy", "food", "finance", "governance", "security", "climate", "education", "population"];

const severityClass = (p: number) =>
  p >= 0.7 ? "bg-destructive/15 text-destructive border-destructive/30" :
  p >= 0.5 ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
             "bg-primary/10 text-primary border-primary/20";

const severityLabel = (p: number) =>
  p >= 0.7 ? "Critical" : p >= 0.5 ? "Elevated" : p >= 0.3 ? "Watch" : "Low";

export default function RiskRankingPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [domainFilter, setDomainFilter] = useState<string>(params.get("domain") ?? "all");
  const [search, setSearch] = useState(params.get("iso3") ?? "");
  const [queryIso3, setQueryIso3] = useState(params.get("iso3") ?? "");
  const [queryDomain, setQueryDomain] = useState<string>(params.get("domain") ?? "energy");

  // ── Leaderboard ──
  const leaderboard = useQuery({
    queryKey: ["risk-ranking-leaderboard", domainFilter],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("predict-risk-ranking", {
        body: { mode: "leaderboard", top_n: 100, ...(domainFilter !== "all" ? { domain: domainFilter } : {}) },
      });
      if (error) throw error;
      return data as { rows: Row[]; generated_at: string; bootstrapped?: boolean };
    },
    staleTime: 30_000,
  });

  // ── Refresh ──
  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("predict-risk-ranking", {
        body: { mode: "refresh", top_n: 200 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Recomputed ${d?.rows_inserted ?? 0} predictions`);
      qc.invalidateQueries({ queryKey: ["risk-ranking-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["top-emerging-risks-home"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  // ── Per-country query ──
  const score = useQuery({
    queryKey: ["risk-score", queryIso3, queryDomain],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("predict-risk-ranking", {
        body: { mode: "score", iso3: queryIso3, domain: queryDomain },
      });
      if (error) throw error;
      return data?.result;
    },
    enabled: queryIso3.length === 3 && !!queryDomain,
  });

  const allRows = leaderboard.data?.rows ?? [];
  const filteredRows = allRows.filter(r =>
    !search || r.country_iso3.toLowerCase().includes(search.toLowerCase())
  );

  // KPIs
  const probs = allRows.map(r => Number(r.risk_probability));
  const critical = probs.filter(p => p >= 0.7).length;
  const elevated = probs.filter(p => p >= 0.5 && p < 0.7).length;
  const watch = probs.filter(p => p >= 0.3 && p < 0.5).length;
  const avg = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : 0;
  const generatedAt = leaderboard.data?.generated_at ? new Date(leaderboard.data.generated_at) : null;
  const ageHours = generatedAt ? (Date.now() - generatedAt.getTime()) / 3_600_000 : 999;
  const isStale = ageHours > 24;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Flame className="h-5 w-5 text-destructive" />
              Emerging Risks
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Predicts which country–domain pairs are most likely to deteriorate over the next 7 days.
              Baseline model · momentum + volatility + z-score blend.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider border rounded px-2 py-1 ${
              isStale ? "border-amber-500/30 text-amber-500" : "border-border text-muted-foreground"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isStale ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
              {generatedAt ? (isStale ? `Stale ${Math.round(ageHours)}h` : `Updated ${Math.round(ageHours)}h ago`) : "Never run"}
            </span>
            <Button onClick={() => refresh.mutate()} disabled={refresh.isPending} size="sm" className="gap-2 h-8">
              {refresh.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recompute now
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Predictions</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1">{allRows.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Critical ≥70%</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-destructive mt-1">{critical}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Elevated 50–70%</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-500 mt-1">{elevated}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg probability</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-primary mt-1">{(avg * 100).toFixed(0)}%</div>
          </Card>
        </div>

        {/* Severity distribution bar */}
        {allRows.length > 0 && (
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-destructive" style={{ width: `${(critical / allRows.length) * 100}%` }} />
            <div className="bg-amber-500" style={{ width: `${(elevated / allRows.length) * 100}%` }} />
            <div className="bg-primary/60" style={{ width: `${(watch / allRows.length) * 100}%` }} />
          </div>
        )}

        <Tabs defaultValue="leaderboard">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="leaderboard" className="gap-2 text-xs data-[state=active]:bg-card"><Flame className="h-3.5 w-3.5" /> Top emerging risks</TabsTrigger>
            <TabsTrigger value="actions" className="gap-2 text-xs data-[state=active]:bg-card"><Target className="h-3.5 w-3.5" /> Recommended actions</TabsTrigger>
            <TabsTrigger value="query" className="gap-2 text-xs data-[state=active]:bg-card"><Search className="h-3.5 w-3.5" /> Per-country forecast</TabsTrigger>
          </TabsList>

          <TabsContent value="actions" className="space-y-3 mt-4">
            <PanelBoundary><RecommendedActionsPanel topN={50} /></PanelBoundary>
          </TabsContent>

          {/* ── Leaderboard tab ── */}
          <TabsContent value="leaderboard" className="space-y-3 mt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={domainFilter} onValueChange={setDomainFilter}>
                <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOMAINS.map(d => <SelectItem key={d} value={d} className="capitalize">{d === "all" ? "All domains" : d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Filter by ISO3 (e.g. GHA)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-[200px] h-9 text-xs font-mono uppercase"
              />
              <span className="text-xs text-muted-foreground tabular-nums">{filteredRows.length} of {allRows.length}</span>
            </div>

            <Card className="border-border">
              <CardContent className="p-0">
                {leaderboard.isLoading ? (
                  <div className="p-3"><PanelSkeleton variant="list" rows={8} header={false} /></div>
                ) : filteredRows.length === 0 ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    No predictions match your filters. Try recomputing.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredRows.map((r) => {
                      const f = r.factors ?? {};
                      return (
                        <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition">
                          <span className="text-[11px] font-mono text-muted-foreground w-8 shrink-0">#{r.rank_position}</span>
                          <span className="text-sm font-mono font-semibold w-12 shrink-0">{r.country_iso3}</span>
                          <span className="text-sm capitalize w-24 shrink-0 text-muted-foreground">{r.domain}</span>
                          <div className="flex-1 min-w-0 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                            <span title="Performance index">PI {Number(f.performance_index ?? 0).toFixed(0)}</span>
                            <span title="Momentum">Mom {Number(f.momentum_score ?? 0).toFixed(2)}</span>
                            <span title="Volatility">Vol {Number(f.volatility_index ?? 0).toFixed(2)}</span>
                            <Badge variant="outline" className="text-[10px] capitalize">{f.forecast_direction ?? "—"}</Badge>
                          </div>
                          <Badge variant="outline" className={`text-[11px] font-mono ${severityClass(Number(r.risk_probability))}`}>
                            {(Number(r.risk_probability) * 100).toFixed(0)}% · {severityLabel(Number(r.risk_probability))}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Per-country query tab ── */}
          <TabsContent value="query" className="space-y-3">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-sm">Forecast deterioration risk</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-xs text-muted-foreground">Country (ISO3)</label>
                    <Input
                      placeholder="GHA"
                      maxLength={3}
                      value={queryIso3}
                      onChange={(e) => setQueryIso3(e.target.value.toUpperCase())}
                      className="h-9 text-sm font-mono uppercase"
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-xs text-muted-foreground">Domain</label>
                    <Select value={queryDomain} onValueChange={setQueryDomain}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DOMAINS.filter(d => d !== "all").map(d =>
                          <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => {
                      setParams({ iso3: queryIso3, domain: queryDomain });
                      qc.invalidateQueries({ queryKey: ["risk-score", queryIso3, queryDomain] });
                    }}
                    className="h-9 gap-2"
                  >
                    <Zap className="h-4 w-4" /> Score
                  </Button>
                </div>

                {queryIso3.length === 3 && (
                  score.isLoading ? (
                    <div className="py-2"><PanelSkeleton variant="metrics" rows={3} header={false} /></div>
                  ) : !score.data || score.data?.factors?.error ? (
                    <p className="text-sm text-muted-foreground py-4">No snapshot available for {queryIso3} · {queryDomain}.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-baseline gap-3">
                        <span className="text-3xl font-bold font-mono">
                          {(Number(score.data.risk_probability) * 100).toFixed(0)}%
                        </span>
                        <Badge variant="outline" className={severityClass(Number(score.data.risk_probability))}>
                          {severityLabel(Number(score.data.risk_probability))}
                        </Badge>
                        <span className="text-xs text-muted-foreground">probability of deterioration · 7d horizon</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <FactorCard label="Performance Index" value={Number(score.data.factors?.performance_index ?? 0).toFixed(1)} icon={<Activity className="h-3 w-3" />} />
                        <FactorCard label="Momentum" value={Number(score.data.factors?.momentum_score ?? 0).toFixed(2)} icon={<TrendingDown className="h-3 w-3" />} />
                        <FactorCard label="Volatility" value={Number(score.data.factors?.volatility_index ?? 0).toFixed(2)} icon={<Activity className="h-3 w-3" />} />
                        <FactorCard label="Confidence" value={Number(score.data.factors?.confidence_score ?? 0).toFixed(2)} icon={<Activity className="h-3 w-3" />} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Direction: <span className="capitalize font-mono">{score.data.factors?.forecast_direction ?? "—"}</span> ·
                        Model: <span className="font-mono">{score.data.factors?.model ?? "baseline-v1"}</span>
                      </p>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
}

const FactorCard = ({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) => (
  <div className="rounded-md border border-border p-2.5 bg-muted/20">
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
      {icon} {label}
    </div>
    <div className="text-base font-mono font-semibold mt-1">{value}</div>
  </div>
);
