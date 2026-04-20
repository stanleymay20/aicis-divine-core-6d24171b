import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, RefreshCw, Brain, Calendar } from "lucide-react";

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

  // Filter to current horizon (run-ml-inference list returns latest batch regardless)
  const rows = (list.data?.rows ?? []).filter(r => Number(r.horizon_days) === Number(horizon));

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" /> ML Predictions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Calibrated risk probabilities with bootstrap prediction intervals. SHA-256 audit hash per row.
              {list.data?.generated_at && ` · last batch ${new Date(list.data.generated_at).toLocaleString()}`}
            </p>
          </div>
          <Button onClick={() => infer.mutate()} disabled={infer.isPending} size="sm" className="gap-2">
            {infer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run inference ({horizon}d)
          </Button>
        </div>

        <Tabs value={horizon} onValueChange={setHorizon}>
          <TabsList>
            {HORIZONS.map(h => (
              <TabsTrigger key={h.key} value={h.key} className="gap-2">
                <Calendar className="h-3.5 w-3.5" /> {h.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {HORIZONS.map(h => (
            <TabsContent key={h.key} value={h.key} className="space-y-3">
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-sm">Top predicted deteriorations · {h.label}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {list.isLoading ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No predictions for {h.label} horizon. Click "Run inference" to generate.
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {rows.map((r, i) => {
                        const p = Number(r.calibrated_score ?? r.risk_probability);
                        const lo = Number(r.prediction_interval_lower ?? p);
                        const hi = Number(r.prediction_interval_upper ?? p);
                        return (
                          <div key={r.id} className="px-4 py-2.5 hover:bg-muted/30 transition flex items-center gap-3">
                            <span className="text-[11px] font-mono text-muted-foreground w-8 shrink-0">#{i + 1}</span>
                            <span className="text-sm font-mono font-semibold w-12 shrink-0">{r.country_iso3}</span>
                            <span className="text-sm capitalize w-24 shrink-0 text-muted-foreground">{r.domain}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                                <span title="raw uncalibrated">raw {Number(r.raw_score ?? 0).toFixed(2)}</span>
                                <span>·</span>
                                <span>95% CI [{(lo * 100).toFixed(0)}–{(hi * 100).toFixed(0)}%]</span>
                                {r.audit_hash && (
                                  <>
                                    <span>·</span>
                                    <span className="font-mono" title={r.audit_hash}>hash {r.audit_hash.slice(0, 8)}…</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <Badge variant="outline" className={`text-[11px] font-mono ${sevClass(p)}`}>
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
