import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRoles } from "@/hooks/useUserRoles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  GitBranch,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

type QueryError = { message?: string };
type QueryResponse<T> = { data: T[] | null; error: QueryError | null };
type LooseQueryBuilder<T> = {
  select: (columns?: string) => LooseQueryBuilder<T>;
  order: (column: string, options?: { ascending?: boolean }) => LooseQueryBuilder<T>;
  limit: (count: number) => PromiseLike<QueryResponse<T>>;
};
type LooseDatabase = {
  from: <T>(relation: string) => LooseQueryBuilder<T>;
};

const db = supabase as unknown as LooseDatabase;

type VerifiedEdge = {
  id: string;
  source_name: string;
  source_entity_id: string;
  source_type?: string;
  target_name: string;
  target_entity_id: string;
  target_type?: string;
  relationship_type: string;
  strength: number | null;
  confidence: number;
};

type Cascade = {
  id: string;
  cascade_key: string;
  origin_name: string;
  terminal_name: string | null;
  systemic_score: number;
  structural_confidence: number;
  causal_confidence: number | null;
  hop_count: number;
  cross_domain_count: number;
  last_detected_at: string;
};

type TopologyChange = {
  id: string;
  change_kind: string;
  entity_name: string | null;
  entity_type: string | null;
  severity: number;
  delta: number | null;
  created_at: string;
};

type CausalAssessment = {
  id: string;
  relationship_id: string;
  verdict: string;
  causal_score: number;
  confidence: number;
  temporal_precedence: number;
  mechanism_support: number;
  contradiction_penalty: number;
  confounder_penalty: number;
  assessed_at: string;
};

export default function IntelligenceEngine() {
  const qc = useQueryClient();
  const { isAdmin, isOperator } = useUserRoles();

  const verifiedGraph = useQuery({
    queryKey: ["cognitive-core", "verified-graph"],
    queryFn: async () => {
      const { data, error } = await db
        .from<VerifiedEdge>("aicis_verified_graph")
        .select("id,source_entity_id,source_name,source_type,target_entity_id,target_name,target_type,relationship_type,strength,confidence")
        .order("confidence", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const cascades = useQuery({
    queryKey: ["cognitive-core", "cascades"],
    queryFn: async () => {
      const { data, error } = await db
        .from<Cascade>("aicis_supported_cascades")
        .select("*")
        .order("systemic_score", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
    retry: 1,
  });

  const topology = useQuery({
    queryKey: ["cognitive-core", "topology"],
    enabled: isAdmin || isOperator,
    queryFn: async () => {
      const { data, error } = await db
        .from<TopologyChange>("aicis_recent_topology_changes")
        .select("id,change_kind,entity_name,entity_type,severity,delta,created_at")
        .order("severity", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    retry: 1,
  });

  const causal = useQuery({
    queryKey: ["cognitive-core", "causal-assessments"],
    enabled: isAdmin || isOperator,
    queryFn: async () => {
      const { data, error } = await db
        .from<CausalAssessment>("aicis_causal_assessments")
        .select("id,relationship_id,verdict,causal_score,confidence,temporal_precedence,mechanism_support,contradiction_penalty,confounder_penalty,assessed_at")
        .order("assessed_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
    retry: 1,
  });

  const topologyScan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("cognitive-topology-scan", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.unchanged ? "World topology unchanged" : "World topology refreshed");
      qc.invalidateQueries({ queryKey: ["cognitive-core"] });
    },
    onError: (error: unknown) => toast.error(errorMessage(error, "Topology scan failed")),
  });

  const causalScan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("cognitive-causal-cascade-scan", {
        body: { max_relationships: 1000, max_cascade_hops: 5, min_causal_score: 0.55 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Causal scan complete · ${data?.supported_cascades ?? 0} supported cascades`);
      qc.invalidateQueries({ queryKey: ["cognitive-core"] });
    },
    onError: (error: unknown) => toast.error(errorMessage(error, "Causal scan failed")),
  });

  const edges = verifiedGraph.data ?? [];
  const supportedCascades = cascades.data ?? [];
  const changes = topology.data ?? [];
  const assessments = causal.data ?? [];

  const causalSupported = assessments.filter((item) => item.verdict === "causally-supported").length;
  const mechanistic = assessments.filter((item) => item.verdict === "mechanistically-supported").length;
  const contradicted = assessments.filter((item) => item.verdict === "contradicted").length;
  const avgGraphConfidence = edges.length
    ? edges.reduce((sum, edge) => sum + Number(edge.confidence ?? 0), 0) / edges.length
    : 0;
  const metrics = {
    verifiedEdges: edges.length,
    avgGraphConfidence,
    supportedCascades: supportedCascades.length,
    causalSupported,
    mechanistic,
    contradicted,
    topologyChanges: changes.length,
  };

  const loading = verifiedGraph.isLoading || cascades.isLoading;

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Understand · Cognitive Core
            </div>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl">
                <BrainCircuit className="h-6 w-6 text-primary" /> Planetary Cognitive Core
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Verified world structure, causal evidence, systemic cascades and topology change. Generated language can propose hypotheses; only evidence-backed state crosses into trusted computation.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 font-normal">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Evidence-first
            </Badge>
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => topologyScan.mutate()} disabled={topologyScan.isPending}>
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${topologyScan.isPending ? "animate-spin" : ""}`} />
                  Scan topology
                </Button>
                <Button size="sm" onClick={() => causalScan.mutate()} disabled={causalScan.isPending}>
                  <GitBranch className={`mr-1.5 h-3.5 w-3.5 ${causalScan.isPending ? "animate-pulse" : ""}`} />
                  Scan causality
                </Button>
              </>
            )}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Metric label="Verified edges" value={metrics.verifiedEdges} icon={<Network className="h-3.5 w-3.5" />} />
          <Metric label="Graph confidence" value={metrics.avgGraphConfidence ? `${(metrics.avgGraphConfidence * 100).toFixed(0)}%` : "—"} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
          <Metric label="Supported cascades" value={metrics.supportedCascades} icon={<GitBranch className="h-3.5 w-3.5" />} />
          <Metric label="Causal support" value={isAdmin || isOperator ? metrics.causalSupported : "restricted"} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
          <Metric label="Mechanistic" value={isAdmin || isOperator ? metrics.mechanistic : "restricted"} icon={<Activity className="h-3.5 w-3.5" />} />
          <Metric label="Topology shifts" value={isAdmin || isOperator ? metrics.topologyChanges : "restricted"} icon={<CircleDashed className="h-3.5 w-3.5" />} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4 text-primary" /> Verified world relationships</CardTitle>
              <CardDescription>Only relationships that crossed the graph trust boundary. This is structured state, not an LLM narrative.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <EmptyState text="Loading verified world model…" />
              ) : edges.length === 0 ? (
                <EmptyState text="No verified relationships have crossed the trust boundary yet." />
              ) : (
                <div className="divide-y divide-border/60">
                  {edges.slice(0, 14).map((edge) => (
                    <div key={edge.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto_1fr_110px] md:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{edge.source_name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{edge.source_type ?? "entity"}</div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <span className="max-w-[150px] truncate">{edge.relationship_type}</span><ArrowRight className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{edge.target_name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{edge.target_type ?? "entity"}</div>
                      </div>
                      <Confidence value={Number(edge.confidence ?? 0)} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-primary" /> Systemic cascades</CardTitle>
              <CardDescription>Multi-hop paths promoted only after structural and causal evidence thresholds are satisfied.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {supportedCascades.length === 0 ? (
                <EmptyState text="No supported cascades yet. Candidate chains remain outside the trusted surface." compact />
              ) : supportedCascades.slice(0, 8).map((cascade) => (
                <div key={cascade.id} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{cascade.origin_name}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{cascade.terminal_name ?? "downstream system"}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{cascade.hop_count} hops · detected {formatRelative(cascade.last_detected_at)}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{Math.round(cascade.systemic_score * 100)} systemic</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] text-muted-foreground">
                    <ConfidenceBar label="Structural" value={cascade.structural_confidence} />
                    <ConfidenceBar label="Causal" value={cascade.causal_confidence ?? 0} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {(isAdmin || isOperator) && (
          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="border-b border-border/60">
                <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" /> Causal evidence ledger</CardTitle>
                <CardDescription>Association is kept separate from causal support. Contradictions and confounders lower the score explicitly.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {assessments.length === 0 ? <EmptyState text="No causal assessments recorded yet." compact /> : assessments.slice(0, 12).map((item) => (
                  <div key={item.id} className="rounded-md border border-border/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant={verdictVariant(item.verdict)} className="text-[10px]">{item.verdict.split("-").join(" ")}</Badge>
                      <span className="font-mono text-xs tabular-nums">{Math.round(item.causal_score * 100)} / 100</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
                      <MiniScore label="Temporal" value={item.temporal_precedence} />
                      <MiniScore label="Mechanism" value={item.mechanism_support} />
                      <MiniScore label="Contradiction" value={item.contradiction_penalty} inverse />
                      <MiniScore label="Confounder" value={item.confounder_penalty} inverse />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-border/60">
                <CardTitle className="flex items-center gap-2 text-base"><CircleDashed className="h-4 w-4 text-primary" /> Structural surprise</CardTitle>
                <CardDescription>Changes in the shape of the world model: emerging connectors, cluster mergers, influence shifts and feedback candidates.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                {changes.length === 0 ? <EmptyState text="No material topology changes in the visible window." compact /> : changes.slice(0, 12).map((change) => (
                  <div key={change.id} className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${change.severity >= 0.8 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                      {change.severity >= 0.8 ? <TriangleAlert className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{change.change_kind.split(".").join(" ")}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{change.entity_name ?? "system-level topology"} · {formatRelative(change.created_at)}</div>
                    </div>
                    <span className="font-mono text-xs tabular-nums">{Math.round(change.severity * 100)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        <section className="grid gap-3 md:grid-cols-4">
          <Principle icon={<ShieldCheck className="h-4 w-4" />} title="Evidence before belief" text="Observed state requires provenance; extracted language cannot certify itself." />
          <Principle icon={<Network className="h-4 w-4" />} title="Structure before prose" text="Graph algorithms compute paths and topology; the LLM explains results rather than guessing them." />
          <Principle icon={<FlaskConical className="h-4 w-4" />} title="Simulation is not fact" text="Counterfactual and predicted states remain explicitly separate from observation." />
          <Principle icon={<BrainCircuit className="h-4 w-4" />} title="Learn from outcomes" text="Forecasts and hypotheses become measurable records that can later be calibrated against reality." />
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{icon}{label}</div>
      <div className="mt-1.5 truncate font-mono text-xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <div className="min-w-[90px]">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>confidence</span><span>{Math.round(value * 100)}%</span></div>
      <Progress value={value * 100} className="h-1" />
    </div>
  );
}

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between"><span>{label}</span><span>{Math.round(value * 100)}%</span></div>
      <Progress value={value * 100} className="h-1" />
    </div>
  );
}

function MiniScore({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground"><span>{label}</span><span>{Math.round(value * 100)}</span></div>
      <Progress value={value * 100} className={`mt-1 h-1 ${inverse && value >= 0.5 ? "opacity-70" : ""}`} />
    </div>
  );
}

function Principle({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/15 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold">{icon}{title}</div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center text-center text-xs text-muted-foreground ${compact ? "min-h-24" : "min-h-40"}`}>
      <div><CircleDashed className="mx-auto mb-2 h-5 w-5 opacity-60" />{text}</div>
    </div>
  );
}

function verdictVariant(verdict: string): "default" | "secondary" | "destructive" | "outline" {
  if (verdict === "causally-supported") return "default";
  if (verdict === "contradicted") return "destructive";
  if (verdict === "mechanistically-supported") return "secondary";
  return "outline";
}

function formatRelative(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "unknown time";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
