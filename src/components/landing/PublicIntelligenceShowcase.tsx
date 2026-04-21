import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, Activity, Hash, TrendingUp, GitBranch, Globe2 } from "lucide-react";

interface PublicIntelligence {
  generated_at: string;
  stats: {
    countries_tracked: number;
    snapshots: number;
    ml_predictions: number;
    simulations_run: number;
    audit_records: number;
  };
  top_predictions: Array<{
    country_iso3: string;
    domain: string;
    calibrated_score: number;
    raw_score: number;
    prediction_interval_lower: number;
    prediction_interval_upper: number;
    horizon_days: number;
    audit_hash: string;
    model_version: string;
  }>;
  recent_simulations: Array<{
    scenario_name: string;
    shock_domain: string;
    shock_magnitude: number;
    p10: number | null;
    p50: number | null;
    p90: number | null;
    n_iterations: number;
    cascade_depth: number;
    created_at: string;
  }>;
  audit_samples: Array<{
    model_version: string;
    weights_hash: string;
    combined_hash: string;
    previous_audit_hash: string | null;
    generated_at: string;
  }>;
}

const sevColor = (p: number) =>
  p >= 0.8 ? "text-destructive border-destructive/40 bg-destructive/10" :
  p >= 0.5 ? "text-amber-500 border-amber-500/40 bg-amber-500/10" :
             "text-primary border-primary/30 bg-primary/10";

const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export const PublicIntelligenceShowcase = () => {
  const [data, setData] = useState<PublicIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await supabase.functions.invoke("public-intelligence");
        if (cancelled) return;
        if (res.error) throw res.error;
        setData(res.data as PublicIntelligence);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="border-t border-border bg-gradient-to-b from-background via-card/20 to-background">
      <div className="max-w-7xl mx-auto px-6 py-20">
        {/* Header */}
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4 border-success/40 text-success bg-success/5">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse mr-2" />
            Live Intelligence Feed
          </Badge>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            See it operating right now.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real-time output from production engines — calibrated ML predictions, Monte Carlo simulations,
            and the cryptographic audit chain that ties every inference to an immutable hash.
          </p>
        </div>

        {/* Live stats strip */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : err ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Live feed temporarily unavailable.
          </div>
        ) : data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-12">
              {[
                { v: data.stats.countries_tracked, l: "Countries", icon: Globe2 },
                { v: fmtNum(data.stats.snapshots), l: "Snapshots", icon: Activity },
                { v: fmtNum(data.stats.ml_predictions), l: "ML Predictions", icon: TrendingUp },
                { v: data.stats.simulations_run, l: "Simulations", icon: GitBranch },
                { v: fmtNum(data.stats.audit_records), l: "Audit Records", icon: Hash },
              ].map((s) => (
                <Card key={s.l} className="p-4 text-center bg-card/50 border-border">
                  <s.icon className="h-4 w-4 mx-auto mb-2 text-primary/70" />
                  <div className="text-2xl font-bold font-mono text-primary">{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{s.l}</div>
                </Card>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* ─── Top ML Predictions ─── */}
              <Card className="p-5 bg-card border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      Top calibrated risk predictions
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Isotonic-calibrated · 95% prediction interval · model {data.top_predictions[0]?.model_version}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">7d horizon</Badge>
                </div>
                <div className="space-y-1.5">
                  {data.top_predictions.slice(0, 6).map((p, i) => {
                    const score = Number(p.calibrated_score);
                    const lo = Number(p.prediction_interval_lower);
                    const hi = Number(p.prediction_interval_upper);
                    return (
                      <div key={p.audit_hash} className="flex items-center gap-3 px-2.5 py-2 rounded hover:bg-muted/30 transition">
                        <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                        <span className="text-sm font-mono font-semibold w-10 shrink-0">{p.country_iso3}</span>
                        <span className="text-xs capitalize text-muted-foreground w-20 shrink-0">{p.domain}</span>
                        <div className="flex-1 min-w-0 text-[10px] text-muted-foreground font-mono truncate">
                          CI [{(lo * 100).toFixed(0)}–{(hi * 100).toFixed(0)}%] · hash {p.audit_hash.slice(0, 8)}…
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${sevColor(score)}`}>
                          {(score * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* ─── Recent Simulations ─── */}
              <Card className="p-5 bg-card border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-primary" />
                      Monte Carlo scenarios
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Mulberry32 PRNG · Box-Muller normals · p10/p50/p90 distributions
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  {data.recent_simulations.map((s, i) => (
                    <div key={i} className="px-3 py-2.5 rounded border border-border/60 bg-background/40">
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <span className="text-xs font-medium truncate">{s.scenario_name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                          {s.shock_domain} · {(s.shock_magnitude * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      {s.p50 !== null ? (
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-[9px] uppercase text-muted-foreground tracking-wider">p10</div>
                            <div className="text-sm font-mono text-success">{s.p10!.toFixed(1)}</div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase text-muted-foreground tracking-wider">p50 (median)</div>
                            <div className="text-base font-mono font-bold text-foreground">{s.p50.toFixed(1)}</div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase text-muted-foreground tracking-wider">p90</div>
                            <div className="text-sm font-mono text-destructive">{s.p90!.toFixed(1)}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground italic">single iteration · no distribution</div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-2 font-mono">
                        {s.n_iterations} iter · cascade depth {s.cascade_depth}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* ─── Audit Hash Chain ─── */}
              <Card className="lg:col-span-2 p-5 bg-card border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Hash className="h-4 w-4 text-primary" />
                      Cryptographic inference audit chain
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      SHA-256 · each record links to the previous via <code className="text-primary">previous_audit_hash</code> — tamper-evident
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5 font-mono text-[10px]">
                  {data.audit_samples.map((a, i) => (
                    <div key={a.combined_hash} className="px-3 py-2 rounded bg-background/40 border border-border/60 flex items-center gap-3 overflow-hidden">
                      <span className="text-muted-foreground w-6 shrink-0">#{i + 1}</span>
                      {a.previous_audit_hash ? (
                        <>
                          <span className="text-muted-foreground truncate hidden md:inline">{a.previous_audit_hash.slice(0, 16)}…</span>
                          <span className="text-primary shrink-0">→</span>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-[9px] shrink-0">genesis</Badge>
                      )}
                      <span className="text-success truncate flex-1">{a.combined_hash.slice(0, 24)}…</span>
                      <span className="text-muted-foreground hidden sm:inline shrink-0">{a.model_version}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 text-center">
                  Showing last {data.audit_samples.length} of {fmtNum(data.stats.audit_records)} audit records ·
                  feed regenerated {new Date(data.generated_at).toLocaleTimeString()}
                </p>
              </Card>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
