import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Database, Download, Play, Target, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type Stats = {
  ok: boolean;
  window: { start: string; end: string; horizon_days: number };
  stats: { rows_inserted: number; rows_with_label: number; build_seconds: number };
  distribution: { train: number; val: number; test: number; positives: number; total: number };
  positive_rate: number;
};

type Row = {
  country_iso3: string;
  domain: string;
  snapshot_date: string;
  metric_zscore_vs_90d: number | null;
  events_count_7d: number | null;
  neighbor_risk_score: number | null;
  label_did_deteriorate: number | null;
  dataset_split: string;
};

type DomainCount = { domain: string; total: number; labeled: number; positives: number };

export default function TrainingDataset() {
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [byDomain, setByDomain] = useState<DomainCount[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);

  // Form state
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(ninetyAgo);
  const [endDate, setEndDate] = useState(today);
  const [horizon, setHorizon] = useState(7);

  async function loadSummary() {
    setLoading(true);
    try {
      const { count } = await supabase
        .from("training_dataset_aicis")
        .select("*", { count: "exact", head: true });
      setTotalRows(count ?? 0);

      const { data: sample } = await supabase
        .from("training_dataset_aicis")
        .select("country_iso3,domain,snapshot_date,metric_zscore_vs_90d,events_count_7d,neighbor_risk_score,label_did_deteriorate,dataset_split")
        .order("snapshot_date", { ascending: false })
        .limit(50);
      setRows((sample ?? []) as Row[]);

      // Domain breakdown
      const { data: dRows } = await supabase
        .from("training_dataset_aicis")
        .select("domain,label_did_deteriorate")
        .limit(5000);
      const map = new Map<string, DomainCount>();
      for (const r of dRows ?? []) {
        const cur = map.get(r.domain) ?? { domain: r.domain, total: 0, labeled: 0, positives: 0 };
        cur.total++;
        if (r.label_did_deteriorate !== null) cur.labeled++;
        if (r.label_did_deteriorate === 1) cur.positives++;
        map.set(r.domain, cur);
      }
      setByDomain([...map.values()].sort((a, b) => b.total - a.total));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  async function handleBuild() {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("build-training-dataset", {
        body: { start_date: startDate, end_date: endDate, horizon_days: horizon },
      });
      if (error) throw error;
      setLastBuild(data as Stats);
      toast.success(`Built ${data.stats.rows_inserted} rows in ${Number(data.stats.build_seconds).toFixed(1)}s`);
      await loadSummary();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Build failed: ${msg}`);
    } finally {
      setBuilding(false);
    }
  }

  function handleExport(split: "train" | "val" | "test" | "all") {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/build-training-dataset?export=csv&split=${split}`;
    window.open(url, "_blank");
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <Helmet>
        <title>AICIS Training Dataset — ML Model Foundation</title>
        <meta
          name="description"
          content="Trainable feature/label dataset for predicting country-domain risk deterioration."
        />
      </Helmet>

      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Training Dataset — Risk Deterioration Model</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          One row = one (country, domain, snapshot date). Features are computed only from data observable
          at time T; the label checks whether the metric got &gt;1 standard deviation worse{" "}
          <span className="font-medium">{horizon} days later</span>. Leakage-safe by construction.
        </p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Total rows</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "…" : totalRows.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Domains</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{byDomain.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Labeled rows</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {byDomain.reduce((s, d) => s + d.labeled, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Positive rate</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(() => {
                const lab = byDomain.reduce((s, d) => s + d.labeled, 0);
                const pos = byDomain.reduce((s, d) => s + d.positives, 0);
                return lab > 0 ? `${((pos / lab) * 100).toFixed(1)}%` : "—";
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="build">
        <TabsList>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="domains">Per-Domain</TabsTrigger>
          <TabsTrigger value="sample">Sample Rows</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        {/* BUILD */}
        <TabsContent value="build">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-4 w-4" /> Materialize features &amp; labels
              </CardTitle>
              <CardDescription>
                Walks every (country, domain) for every day in the range. Idempotent — re-running upserts
                rows. The most recent {horizon} days will have features but no label yet (label needs the
                future).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="start">Start date</Label>
                  <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="end">End date</Label>
                  <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="horizon">Horizon (days)</Label>
                  <Input
                    id="horizon"
                    type="number"
                    min={1}
                    max={90}
                    value={horizon}
                    onChange={(e) => setHorizon(Number(e.target.value))}
                  />
                </div>
              </div>
              <Button onClick={handleBuild} disabled={building} className="w-full md:w-auto">
                {building ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building…</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" /> Build dataset</>
                )}
              </Button>

              {lastBuild && (
                <div className="border rounded p-4 bg-muted/30 space-y-2 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Built in {lastBuild.stats.build_seconds.toFixed(1)}s
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>Rows inserted: <strong>{lastBuild.stats.rows_inserted}</strong></div>
                    <div>Labeled: <strong>{lastBuild.stats.rows_with_label}</strong></div>
                    <div>Positive rate: <strong>{(lastBuild.positive_rate * 100).toFixed(1)}%</strong></div>
                    <div>Train/Val/Test: <strong>{lastBuild.distribution.train}/{lastBuild.distribution.val}/{lastBuild.distribution.test}</strong></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* DOMAINS */}
        <TabsContent value="domains">
          <Card>
            <CardHeader>
              <CardTitle>Coverage by domain</CardTitle>
              <CardDescription>Where the model has training signal vs. where it's data-starved.</CardDescription>
            </CardHeader>
            <CardContent>
              {byDomain.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2" />
                  No rows yet — run a build above.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead className="text-right">Total rows</TableHead>
                      <TableHead className="text-right">Labeled</TableHead>
                      <TableHead className="text-right">Positives</TableHead>
                      <TableHead className="text-right">Pos rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byDomain.map((d) => (
                      <TableRow key={d.domain}>
                        <TableCell className="font-medium capitalize">{d.domain}</TableCell>
                        <TableCell className="text-right">{d.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{d.labeled.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{d.positives.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {d.labeled > 0 ? `${((d.positives / d.labeled) * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SAMPLE */}
        <TabsContent value="sample">
          <Card>
            <CardHeader>
              <CardTitle>Recent rows (50)</CardTitle>
              <CardDescription>Sanity-check feature values and labels.</CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">No rows yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">z-score</TableHead>
                        <TableHead className="text-right">Events 7d</TableHead>
                        <TableHead className="text-right">Neighbor risk</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Split</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{r.snapshot_date}</TableCell>
                          <TableCell className="font-medium">{r.country_iso3}</TableCell>
                          <TableCell className="capitalize">{r.domain}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {r.metric_zscore_vs_90d?.toFixed(2) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">{r.events_count_7d ?? 0}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {r.neighbor_risk_score?.toFixed(2) ?? "—"}
                          </TableCell>
                          <TableCell>
                            {r.label_did_deteriorate === 1 ? (
                              <Badge variant="destructive">Deteriorated</Badge>
                            ) : r.label_did_deteriorate === 0 ? (
                              <Badge variant="outline">Stable</Badge>
                            ) : (
                              <Badge variant="secondary">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell><Badge variant="outline">{r.dataset_split}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* EXPORT */}
        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4" /> Export for external training
              </CardTitle>
              <CardDescription>
                Download CSV slices ready to drop into a Python notebook (XGBoost, LightGBM, sklearn). The
                column <code className="text-xs">label_did_deteriorate</code> is your target.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Button variant="outline" onClick={() => handleExport("train")}>
                  <Download className="h-4 w-4 mr-1" /> Train CSV
                </Button>
                <Button variant="outline" onClick={() => handleExport("val")}>
                  <Download className="h-4 w-4 mr-1" /> Val CSV
                </Button>
                <Button variant="outline" onClick={() => handleExport("test")}>
                  <Download className="h-4 w-4 mr-1" /> Test CSV
                </Button>
                <Button onClick={() => handleExport("all")}>
                  <Download className="h-4 w-4 mr-1" /> All CSV
                </Button>
              </div>
              <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
                <p className="font-medium mb-1">Quick-start (Python):</p>
                <pre className="bg-muted/50 p-2 rounded overflow-x-auto">
{`import pandas as pd, xgboost as xgb
from sklearn.metrics import roc_auc_score
train = pd.read_csv("aicis_training_train.csv")
val = pd.read_csv("aicis_training_val.csv")
features = [c for c in train.columns if c not in
  ["id","country_iso3","domain","snapshot_date","dataset_split",
   "label_did_deteriorate","label_zscore_at_horizon",
   "label_metric_value_at_horizon","built_at","is_real_data","horizon_days"]]
m = xgb.XGBClassifier(n_estimators=400, max_depth=5, learning_rate=0.05)
m.fit(train[features], train["label_did_deteriorate"])
print("AUC:", roc_auc_score(val["label_did_deteriorate"], m.predict_proba(val[features])[:,1]))`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
