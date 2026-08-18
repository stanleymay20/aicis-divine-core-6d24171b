import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SEO } from "@/components/SEO";
import { Network, Radar, FlaskConical, ScrollText, ShieldCheck, AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const num = (v: unknown, digits = 2) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toFixed(digits);

const int = (v: unknown) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString();

const when = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

const statusTone = (s?: string | null) => {
  switch (s) {
    case "measured":
    case "supported":
    case "success":
    case "PASS":
    case "realized":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "anomaly":
    case "FAIL":
    case "error":
    case "not_supported":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    case "stale_input":
    case "inconclusive":
    case "unvalidated":
    case "insufficient_evidence":
    case "expired_unscored":
    case "corroborated_cluster":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
};

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/30 p-6 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground mt-1">{hint}</p>
        </div>
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  description,
  loading,
  error,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  loading?: boolean;
  error?: unknown;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : error ? (
          <Empty
            title="This panel could not load its evidence."
            hint={(error as Error)?.message ?? "Unknown error"}
          />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* queries                                                             */
/* ------------------------------------------------------------------ */

const table = async <T,>(
  name: string,
  build: (q: any) => any = (q) => q,
): Promise<T[]> => {
  const { data, error } = await build(supabase.from(name as any).select("*"));
  if (error) throw error;
  return (data ?? []) as T[];
};

const count = async (name: string, build: (q: any) => any = (q) => q) => {
  const { count: c, error } = await build(
    supabase.from(name as any).select("*", { count: "exact", head: true }),
  );
  if (error) throw error;
  return c ?? 0;
};

/* ------------------------------------------------------------------ */
/* sections                                                            */
/* ------------------------------------------------------------------ */

function GraphSection() {
  const edges = useQuery({
    queryKey: ["pi-graph-edges"],
    queryFn: () =>
      table<any>("graph_relationship_current", (q) =>
        q.not("decayed_weight", "is", null).order("decayed_weight", { ascending: false }).limit(40),
      ),
  });

  const totals = useQuery({
    queryKey: ["pi-graph-totals"],
    queryFn: async () => ({
      total: await count("graph_relationship_evidence"),
      measured: await count("graph_relationship_evidence", (q) =>
        q.eq("evidence_status", "measured"),
      ),
      unvalidated: await count("graph_relationship_evidence", (q) =>
        q.eq("evidence_status", "unvalidated"),
      ),
      insufficient: await count("graph_relationship_evidence", (q) =>
        q.eq("evidence_status", "insufficient_evidence"),
      ),
    }),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Relationships" value={int(totals.data?.total)} />
        <Stat label="Measured" value={int(totals.data?.measured)} tone="text-emerald-300" />
        <Stat label="Unvalidated" value={int(totals.data?.unvalidated)} tone="text-amber-300" />
        <Stat
          label="Insufficient evidence"
          value={int(totals.data?.insufficient)}
          tone="text-amber-300"
        />
      </div>

      <Panel
        icon={<Network className="h-4 w-4 text-primary" />}
        title="Strongest current relationships"
        description="Weight decays with the age of the evidence. Only measured relationships carry weight; assumptions are labelled as such."
        loading={edges.isLoading}
        error={edges.error}
      >
        {edges.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead>Object</TableHead>
                  <TableHead className="text-right">Strength</TableHead>
                  <TableHead className="text-right">Decayed</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">Age (d)</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {edges.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.subject_key}</TableCell>
                    <TableCell className="text-xs">{e.relation_type}</TableCell>
                    <TableCell className="font-mono text-xs">{e.object_key}</TableCell>
                    <TableCell className="text-right">{num(e.evidence_strength, 3)}</TableCell>
                    <TableCell className="text-right">{num(e.decayed_weight, 3)}</TableCell>
                    <TableCell className="text-right">{int(e.sample_size)}</TableCell>
                    <TableCell className="text-right">{num(e.evidence_age_days, 0)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusTone(e.evidence_status)}>
                        {e.evidence_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty
            title="No relationships carry measured evidence yet."
            hint="Run the graph evidence refresh so measured correlations and dependency measurements are promoted into the graph."
          />
        )}
      </Panel>
    </div>
  );
}

function DiscoverySection() {
  const runs = useQuery({
    queryKey: ["pi-ws-runs"],
    queryFn: () =>
      table<any>("weak_signal_runs", (q) => q.order("started_at", { ascending: false }).limit(5)),
  });

  const detections = useQuery({
    queryKey: ["pi-ws-detections"],
    queryFn: () =>
      table<any>("weak_signal_detections", (q) =>
        q.order("confidence", { ascending: false }).limit(50),
      ),
  });

  const latest = runs.data?.[0];

  return (
    <div className="space-y-4">
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Last run" value={when(latest.started_at)} />
          <Stat label="Run status" value={latest.status} />
          <Stat label="Input date" value={latest.input_max_date ?? "—"} />
          <Stat
            label="Input staleness"
            value={`${int(latest.input_stale_days)} d`}
            tone={Number(latest.input_stale_days) > 21 ? "text-amber-300" : undefined}
          />
          <Stat label="Detections" value={int(latest.detections_written)} />
        </div>
      )}

      {latest?.status === "stale_input" && (
        <Empty
          title="The last discovery pass ran on stale input."
          hint={`Country performance snapshots are ${latest.input_stale_days} days old. Detections below are still real, but they describe an out-of-date world state.`}
        />
      )}

      <Panel
        icon={<Radar className="h-4 w-4 text-primary" />}
        title="Anomalies and weak signals"
        description="Statistical deviation against each country-domain's own historical baseline, ranked by corroborated confidence."
        loading={detections.isLoading}
        error={detections.error}
      >
        {detections.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">z</TableHead>
                  <TableHead className="text-right">Observed</TableHead>
                  <TableHead className="text-right">Baseline</TableHead>
                  <TableHead className="text-right">Baseline n</TableHead>
                  <TableHead className="text-right">Domains</TableHead>
                  <TableHead className="text-right">Sources</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detections.data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.iso3}</TableCell>
                    <TableCell className="text-xs">{d.domain}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusTone(d.signal_class)}>
                        {d.signal_class.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{num(d.z_score, 2)}</TableCell>
                    <TableCell className="text-right">{num(d.observed_value, 2)}</TableCell>
                    <TableCell className="text-right">
                      {num(d.baseline_mean, 2)} ± {num(d.baseline_stddev, 2)}
                    </TableCell>
                    <TableCell className="text-right">{int(d.baseline_sample_size)}</TableCell>
                    <TableCell className="text-right">{int(d.corroborating_domains)}</TableCell>
                    <TableCell className="text-right">{int(d.corroborating_sources)}</TableCell>
                    <TableCell className="text-right">{num(d.confidence, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty
            title="No detections recorded."
            hint="Either no country-domain has deviated beyond threshold, or no baseline has enough history yet. Run the discovery pass to refresh."
          />
        )}
      </Panel>
    </div>
  );
}

function ExperimentsSection() {
  const hypotheses = useQuery({
    queryKey: ["pi-hypotheses"],
    queryFn: () =>
      table<any>("intelligence_hypotheses", (q) => q.order("hypothesis_key").limit(100)),
  });

  const evaluations = useQuery({
    queryKey: ["pi-hypothesis-evals"],
    queryFn: () =>
      table<any>("hypothesis_evaluations", (q) =>
        q.order("evaluated_at", { ascending: false }).limit(100),
      ),
  });

  const latestFor = (id: string) => evaluations.data?.find((e) => e.hypothesis_id === id);

  return (
    <Panel
      icon={<FlaskConical className="h-4 w-4 text-primary" />}
      title="Registered hypotheses and their test results"
      description="Each claim is declared with its method, minimum sample and significance level before it is tested. Results are permanent and cannot be edited."
      loading={hypotheses.isLoading || evaluations.isLoading}
      error={hypotheses.error ?? evaluations.error}
    >
      {hypotheses.data?.length ? (
        <div className="space-y-3">
          {hypotheses.data.map((h) => {
            const e = latestFor(h.id);
            return (
              <div key={h.id} className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="max-w-3xl">
                    <p className="text-sm font-medium">{h.statement}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {h.subject_domain} → {h.object_domain} · lag {h.lag_days}d · {h.method} · α ={" "}
                      {h.alpha} · min n = {int(h.min_sample_size)}
                    </p>
                  </div>
                  <Badge variant="outline" className={statusTone(h.status)}>
                    {h.status.replace(/_/g, " ")}
                  </Badge>
                </div>

                {e ? (
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3">
                    <Stat label="Sample" value={int(e.sample_size)} />
                    <Stat label="Countries" value={int(e.country_count)} />
                    <Stat label="Effect r" value={num(e.effect_size, 3)} />
                    <Stat
                      label="95% CI"
                      value={
                        e.ci_lower === null || e.ci_upper === null
                          ? "—"
                          : `${num(e.ci_lower, 2)} … ${num(e.ci_upper, 2)}`
                      }
                    />
                    <Stat
                      label="p"
                      value={e.p_value === null ? "—" : Number(e.p_value) < 1e-6 ? "<1e-6" : num(e.p_value, 6)}
                    />
                    <Stat label="Tested" value={when(e.evaluated_at)} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-3">Not yet evaluated.</p>
                )}

                {e?.verdict === "inconclusive" && (
                  <p className="text-xs text-amber-300 mt-2">
                    Inconclusive: the underlying data could not support a valid test (insufficient
                    sample or a non-varying input series). This is reported rather than hidden.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          title="No hypotheses registered."
          hint="Register a testable claim so the system can evaluate it against real history instead of asserting it."
        />
      )}
    </Panel>
  );
}

function LedgerSection() {
  const perf = useQuery({
    queryKey: ["pi-ledger-perf"],
    queryFn: () =>
      table<any>("prediction_ledger_performance", (q) =>
        q.order("sealed_total", { ascending: false }).limit(60),
      ),
  });

  const recent = useQuery({
    queryKey: ["pi-ledger-recent"],
    queryFn: () =>
      table<any>("prediction_ledger", (q) =>
        q.order("sequence_number", { ascending: false }).limit(25),
      ),
  });

  const totals = perf.data?.reduce(
    (acc, r) => ({
      sealed: acc.sealed + Number(r.sealed_total ?? 0),
      scored: acc.scored + Number(r.scored_total ?? 0),
      open: acc.open + Number(r.open_awaiting_horizon ?? 0),
      expired: acc.expired + Number(r.expired_unscored ?? 0),
    }),
    { sealed: 0, scored: 0, open: 0, expired: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Sealed predictions" value={int(totals?.sealed)} />
        <Stat label="Scored vs reality" value={int(totals?.scored)} tone="text-emerald-300" />
        <Stat label="Awaiting horizon" value={int(totals?.open)} />
        <Stat
          label="Expired unscored"
          value={int(totals?.expired)}
          tone={Number(totals?.expired) > 0 ? "text-amber-300" : undefined}
        />
      </div>

      <Panel
        icon={<ScrollText className="h-4 w-4 text-primary" />}
        title="Prediction performance by model and domain"
        description="Every sealed prediction is accounted for: scored, still awaiting its horizon, or expired without an outcome. Nothing is quietly dropped."
        loading={perf.isLoading}
        error={perf.error}
      >
        {perf.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead className="text-right">Sealed</TableHead>
                  <TableHead className="text-right">Scored</TableHead>
                  <TableHead className="text-right">Scored %</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Brier</TableHead>
                  <TableHead className="text-right">Predicted</TableHead>
                  <TableHead className="text-right">Observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perf.data.map((r, i) => {
                  const gap =
                    r.mean_predicted !== null && r.mean_observed !== null
                      ? Math.abs(Number(r.mean_predicted) - Number(r.mean_observed))
                      : null;
                  return (
                    <TableRow key={`${r.model_version}-${r.domain}-${i}`}>
                      <TableCell className="font-mono text-xs">{r.model_version}</TableCell>
                      <TableCell className="text-xs">{r.domain ?? "—"}</TableCell>
                      <TableCell className="text-right">{int(r.sealed_total)}</TableCell>
                      <TableCell className="text-right">{int(r.scored_total)}</TableCell>
                      <TableCell className="text-right">{num(r.scored_pct, 1)}%</TableCell>
                      <TableCell className="text-right">{int(r.open_awaiting_horizon)}</TableCell>
                      <TableCell className="text-right">{int(r.expired_unscored)}</TableCell>
                      <TableCell className="text-right">{num(r.mean_brier_score, 4)}</TableCell>
                      <TableCell className="text-right">{num(r.mean_predicted, 3)}</TableCell>
                      <TableCell
                        className={`text-right ${gap !== null && gap > 0.3 ? "text-rose-300 font-medium" : ""}`}
                      >
                        {num(r.mean_observed, 3)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              A large gap between the predicted and observed columns is a calibration failure, shown
              here deliberately rather than averaged away.
            </p>
          </div>
        ) : (
          <Empty
            title="No predictions sealed yet."
            hint="Seal production predictions into the ledger so their accuracy can be measured once their horizon elapses."
          />
        )}
      </Panel>

      <Panel
        icon={<ScrollText className="h-4 w-4 text-primary" />}
        title="Most recent sealed predictions"
        description="Each entry is hash-chained to the one before it, so any edit or deletion is detectable."
        loading={recent.isLoading}
        error={recent.error}
      >
        {recent.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">P(risk)</TableHead>
                  <TableHead className="text-right">Horizon</TableHead>
                  <TableHead>Target date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chain hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{int(p.sequence_number)}</TableCell>
                    <TableCell className="font-mono text-xs">{p.subject_key}</TableCell>
                    <TableCell className="text-right">{num(p.predicted_probability, 3)}</TableCell>
                    <TableCell className="text-right">{int(p.horizon_days)}d</TableCell>
                    <TableCell className="text-xs">{p.target_date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusTone(p.status)}>
                        {p.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {String(p.chain_hash).slice(0, 16)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty title="Ledger is empty." hint="No predictions have been sealed yet." />
        )}
      </Panel>
    </div>
  );
}

function CertificationSection() {
  const run = useQuery({
    queryKey: ["pi-certification"],
    queryFn: async () => {
      const rows = await table<any>("pns_certification_runs", (q) =>
        q.order("run_at", { ascending: false }).limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const gates: any[] = Array.isArray(run.data?.gates) ? run.data.gates : [];

  return (
    <Panel
      icon={<ShieldCheck className="h-4 w-4 text-primary" />}
      title="Live capability certification"
      description="Every gate is measured from production data. A capability that cannot be measured is recorded as a failure, never as a pass."
      loading={run.isLoading}
      error={run.error}
    >
      {run.data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Overall score" value={`${num(run.data.overall_score, 2)} / 100`} />
            <Stat label="Gates passed" value={`${int(run.data.gates_passed)} / ${int(run.data.gates_total)}`} />
            <Stat label="Gates failed" value={int(Number(run.data.gates_total) - Number(run.data.gates_passed))} />
            <Stat label="Measured at" value={when(run.data.run_at)} />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gate</TableHead>
                  <TableHead>What is measured</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gates.map((g) => (
                  <TableRow key={g.gate}>
                    <TableCell className="font-mono text-xs">{g.gate}</TableCell>
                    <TableCell className="text-xs">{g.metric}</TableCell>
                    <TableCell className="text-right text-xs">{String(g.target)}</TableCell>
                    <TableCell className="text-right text-xs">
                      {g.value === null ? "not measurable" : String(g.value)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusTone(g.status)}>
                        {g.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground max-w-md">
                      {g.evidence}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <Empty
          title="No certification run recorded."
          hint="Run the certification cycle to produce a measured capability scorecard."
        />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function PlanetaryIntelligence() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1500px] mx-auto h-full overflow-y-auto space-y-5 animate-fade-in">
      <SEO
        title="Planetary Intelligence — Evidence, Discovery & Prediction Ledger"
        description="Evidence-weighted planetary knowledge graph, weak-signal discovery, hypothesis testing and a tamper-evident prediction ledger, all measured from live production data."
      />

      <header>
        <div className="flex items-center gap-2 flex-wrap">
          <Network className="h-6 w-6 text-primary" />
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Planetary Intelligence
          </h1>
          <Badge variant="outline" className="uppercase tracking-wider text-[10px]">
            Measured
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          What the system actually knows, how strong that evidence is, what it has predicted, and how
          often it was right. Unmeasurable claims are reported as failures rather than presented as
          capability.
        </p>
      </header>

      <Tabs defaultValue="graph" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="graph">Knowledge graph</TabsTrigger>
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
          <TabsTrigger value="experiments">Experiments</TabsTrigger>
          <TabsTrigger value="ledger">Prediction ledger</TabsTrigger>
          <TabsTrigger value="certification">Certification</TabsTrigger>
        </TabsList>

        <TabsContent value="graph">
          <GraphSection />
        </TabsContent>
        <TabsContent value="discovery">
          <DiscoverySection />
        </TabsContent>
        <TabsContent value="experiments">
          <ExperimentsSection />
        </TabsContent>
        <TabsContent value="ledger">
          <LedgerSection />
        </TabsContent>
        <TabsContent value="certification">
          <CertificationSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
