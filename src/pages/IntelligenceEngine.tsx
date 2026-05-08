import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryPanel } from "@/components/ui/query-panel";
import { toast } from "sonner";
import { Brain, Network, FlaskConical, RefreshCw, Play, AlertTriangle, Activity, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const DOMAINS = ["governance", "health", "energy", "finance", "food", "security", "education", "climate", "population"];

export default function IntelligenceEngine() {
  const qc = useQueryClient();
  const [domain, setDomain] = useState<string>("all");

  // ── ML Inference ──
  const ml = useQuery({
    queryKey: ["ml-predictions", domain],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ml-inference", {
        body: { mode: "list", top_n: 50, domain: domain === "all" ? undefined : domain },
      });
      if (error) throw error;
      return data;
    },
  });

  const inferMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ml-inference", { body: { mode: "infer" } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => { toast.success(`Inferred ${d?.rows_inserted ?? 0} predictions`); qc.invalidateQueries({ queryKey: ["ml-predictions"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Graph Propagation ──
  const prop = useQuery({
    queryKey: ["propagation", domain],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("compute-graph-propagation", {
        body: { mode: "list", top_n: 50, domain: domain === "all" ? undefined : domain },
      });
      if (error) throw error;
      return data;
    },
  });

  const propMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("compute-graph-propagation", { body: { mode: "compute" } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => { toast.success(`Computed ${d?.rows_inserted ?? 0} contagion paths`); qc.invalidateQueries({ queryKey: ["propagation"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Simulations ──
  const sims = useQuery({
    queryKey: ["simulations"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-simulation", { body: { mode: "list", limit: 20 } });
      if (error) throw error;
      return data;
    },
  });

  const [simName, setSimName] = useState("Food shock — Brazil");
  const [simDomain, setSimDomain] = useState("food");
  const [simIso, setSimIso] = useState("BRA");
  const [simMag, setSimMag] = useState("0.10");

  const runSim = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-simulation", {
        body: { mode: "run", scenario_name: simName, domain: simDomain, magnitude: Number(simMag), iso3: simIso || null, direction: "down" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Simulation complete"); qc.invalidateQueries({ queryKey: ["simulations"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // KPI rollup
  const mlRows = (ml.data as any)?.rows ?? [];
  const propRows = (prop.data as any)?.rows ?? [];
  const simRows = (sims.data as any)?.rows ?? [];
  const stats = useMemo(() => {
    const probs = mlRows.map((r: any) => Number(r.risk_probability ?? 0));
    const critical = probs.filter((p: number) => p >= 0.7).length;
    const propScores = propRows.map((r: any) => Number(r.propagation_score ?? 0));
    const highSpill = propScores.filter((s: number) => s >= 0.5).length;
    return {
      predictions: mlRows.length,
      critical,
      paths: propRows.length,
      highSpill,
      sims: simRows.length,
    };
  }, [mlRows, propRows, simRows]);

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" /> Intelligence Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              ML inference · graph propagation · scenario simulation. Logistic baseline v1 · cross-border contagion walk · deterministic what-if shocks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border rounded px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {DOMAINS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"><Brain className="h-3 w-3" /> ML predictions</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1">{stats.predictions}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"><AlertTriangle className="h-3 w-3" /> Critical ≥70%</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-destructive mt-1">{stats.critical}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"><Network className="h-3 w-3" /> Contagion paths</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-primary mt-1">{stats.paths}</div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"><Globe className="h-3 w-3" /> High spillover</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-500 mt-1">{stats.highSpill}</div>
          </Card>
          <Card className="p-3 col-span-2 sm:col-span-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"><FlaskConical className="h-3 w-3" /> Simulations</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1">{stats.sims}</div>
          </Card>
        </div>

        <Tabs defaultValue="ml" className="space-y-4">
          <TabsList className="bg-muted/50 grid grid-cols-3 w-full max-w-2xl">
            <TabsTrigger value="ml" className="text-xs data-[state=active]:bg-card"><Brain className="h-3.5 w-3.5 mr-1.5" /> ML inference</TabsTrigger>
            <TabsTrigger value="graph" className="text-xs data-[state=active]:bg-card"><Network className="h-3.5 w-3.5 mr-1.5" /> Graph propagation</TabsTrigger>
            <TabsTrigger value="sim" className="text-xs data-[state=active]:bg-card"><FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Simulate</TabsTrigger>
          </TabsList>

        {/* ── ML Predictions ── */}
        <TabsContent value="ml">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Risk probabilities (next 7 days)</CardTitle>
                <CardDescription>Logistic baseline · model v1</CardDescription>
              </div>
              <Button size="sm" onClick={() => inferMut.mutate()} disabled={inferMut.isPending}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${inferMut.isPending ? "animate-spin" : ""}`} />
                Run inference
              </Button>
            </CardHeader>
            <CardContent>
              <QueryPanel query={ml} skeleton="table" isEmpty={(d: any) => !d?.rows?.length} emptyMessage="No predictions yet — click Run inference">
                {(d: any) => (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Country</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">Probability</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.rows.slice(0, 30).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono">{r.country_iso3}</TableCell>
                          <TableCell>{r.domain}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={r.risk_probability > 0.6 ? "destructive" : r.risk_probability > 0.4 ? "default" : "secondary"}>
                              {(r.risk_probability * 100).toFixed(1)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </QueryPanel>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Graph Propagation ── */}
        <TabsContent value="graph">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Contagion paths</CardTitle>
                <CardDescription>Risk spreading from origin → target via cross-border signals</CardDescription>
              </div>
              <Button size="sm" onClick={() => propMut.mutate()} disabled={propMut.isPending}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${propMut.isPending ? "animate-spin" : ""}`} />
                Compute
              </Button>
            </CardHeader>
            <CardContent>
              <QueryPanel query={prop} skeleton="table" isEmpty={(d: any) => !d?.rows?.length} emptyMessage="No contagion data — click Compute (requires ML predictions first)">
                {(d: any) => (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Origin</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.rows.slice(0, 30).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono">{r.origin_iso3}</TableCell>
                          <TableCell className="font-mono">{r.target_iso3}</TableCell>
                          <TableCell>{r.domain}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={r.propagation_score > 0.5 ? "destructive" : "secondary"}>
                              {(r.propagation_score * 100).toFixed(1)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </QueryPanel>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Simulations ── */}
        <TabsContent value="sim" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>What-if scenario</CardTitle>
              <CardDescription>Apply a domain shock and project cross-border cascade</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Input placeholder="Scenario name" value={simName} onChange={e => setSimName(e.target.value)} />
                <Select value={simDomain} onValueChange={setSimDomain}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DOMAINS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="ISO3 (optional, e.g. BRA)" value={simIso} onChange={e => setSimIso(e.target.value.toUpperCase())} maxLength={3} />
                <Input placeholder="Magnitude (0–1)" type="number" step="0.05" value={simMag} onChange={e => setSimMag(e.target.value)} />
              </div>
              <Button onClick={() => runSim.mutate()} disabled={runSim.isPending} className="w-full md:w-auto">
                <Play className="h-3.5 w-3.5 mr-1.5" /> Run simulation
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
            <CardContent>
              <QueryPanel query={sims} skeleton="list" isEmpty={(d: any) => !d?.rows?.length} emptyMessage="No simulations yet">
                {(d: any) => (
                  <div className="space-y-2">
                    {d.rows.map((r: any) => (
                      <div key={r.id} className="border rounded-md p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm">{r.scenario_name}</div>
                          <Badge variant="outline">{r.shock_domain} · {r.shock_direction} {(r.shock_magnitude * 100).toFixed(0)}%</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.shock_iso3 ? `Origin: ${r.shock_iso3} · ` : ""}
                          Affected: {Array.isArray(r.affected_countries) ? r.affected_countries.length : 0} countries ·
                          Global impact: {Number(r.estimated_global_impact ?? 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </QueryPanel>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
