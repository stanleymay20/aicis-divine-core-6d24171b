import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserRoles } from "@/hooks/useUserRoles";
import { toast } from "sonner";
import {
  Activity,
  Brain,
  Calendar,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sigma,
} from "lucide-react";
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
  evidence_status?: "legacy_unknown" | "sufficient";
  probability_semantics?:
    | "legacy_unknown"
    | "uncalibrated_logistic_screen_score"
    | "empirical_bin_calibrated_probability";
  calibration_status?:
    | "legacy_unknown"
    | "not_available"
    | "insufficient_sample"
    | "empirical_bin_sufficient";
  calibration_sample_size?: number | null;
  calibration_computed_at?: string | null;
  interval_semantics?: "wilson_95_empirical_calibration_bin_rate" | null;
  source_kind?: "legacy_unknown" | "training_dataset_aicis";
  source_snapshot_date?: string | null;
  feature_completeness?: number | null;
  model_semantics?: "legacy_unknown" | "fixed_logistic_screen";
}

interface MLListResponse {
  rows: MLRow[];
  generated_at?: string;
}

interface InferenceResponse {
  rows_inserted?: number;
  abstentions_recorded?: number;
  calibrated_rows?: number;
  uncalibrated_rows?: number;
  model_version?: string;
  model_semantics?: string;
}

type ScoreSemantics = "calibrated" | "screen" | "legacy";

function scoreSemantics(row: MLRow): ScoreSemantics {
  if (
    row.probability_semantics === "empirical_bin_calibrated_probability" &&
    row.calibration_status === "empirical_bin_sufficient" &&
    row.calibrated_score !== null
  ) {
    return "calibrated";
  }

  if (row.probability_semantics === "uncalibrated_logistic_screen_score") {
    return "screen";
  }

  return "legacy";
}

function displayScore(row: MLRow): number | null {
  const semantics = scoreSemantics(row);
  if (semantics === "calibrated" && row.calibrated_score !== null) {
    return Number.isFinite(Number(row.calibrated_score)) ? Number(row.calibrated_score) : null;
  }
  if (row.raw_score !== null && Number.isFinite(Number(row.raw_score))) {
    return Number(row.raw_score);
  }
  return Number.isFinite(Number(row.risk_probability)) ? Number(row.risk_probability) : null;
}

const scoreClass = (score: number | null) => {
  if (score === null) return "bg-muted text-muted-foreground border-border";
  if (score >= 0.7) return "bg-destructive/15 text-destructive border-destructive/30";
  if (score >= 0.5) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-primary/10 text-primary border-primary/20";
};

function semanticsLabel(row: MLRow): string {
  const semantics = scoreSemantics(row);
  if (semantics === "calibrated") return "empirical probability";
  if (semantics === "screen") return "screen score";
  return "legacy score";
}

function formatSourceDate(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export default function PredictionsPage() {
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: rolesLoading } = useUserRoles();
  const [horizon, setHorizon] = useState("7");
  const [domainFilter, setDomainFilter] = useState<string>("all");

  const list = useQuery({
    queryKey: ["ml-predictions", horizon],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ml-inference", {
        body: { mode: "list", horizon: Number(horizon), top_n: 100 },
      });
      if (error) throw error;
      return data as MLListResponse;
    },
    staleTime: 30_000,
  });

  const infer = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ml-inference", {
        body: { mode: "infer", horizon: Number(horizon) },
      });
      if (error) throw error;
      return data as InferenceResponse;
    },
    onSuccess: (data) => {
      const issued = data?.rows_inserted ?? 0;
      const withheld = data?.abstentions_recorded ?? 0;
      const calibrated = data?.calibrated_rows ?? 0;
      const screened = data?.uncalibrated_rows ?? 0;
      toast.success(
        `Inference complete: ${issued} issued · ${withheld} withheld · ${calibrated} empirically calibrated · ${screened} screening-only`,
      );
      queryClient.invalidateQueries({ queryKey: ["ml-predictions"] });
    },
    onError: (error) => toast.error(String(error)),
  });

  const allRows = (list.data?.rows ?? []).filter(
    (row) => Number(row.horizon_days) === Number(horizon),
  );

  const domains = useMemo(() => {
    const values = new Set<string>();
    allRows.forEach((row) => values.add(row.domain));
    return Array.from(values).sort();
  }, [allRows]);

  const rows = domainFilter === "all"
    ? allRows
    : allRows.filter((row) => row.domain === domainFilter);

  const stats = useMemo(() => {
    const calibrated = allRows.filter((row) => scoreSemantics(row) === "calibrated").length;
    const screens = allRows.filter((row) => scoreSemantics(row) === "screen").length;
    const legacy = allRows.filter((row) => scoreSemantics(row) === "legacy").length;
    const completeEvidence = allRows.filter((row) => row.evidence_status === "sufficient").length;
    const model = allRows[0]?.model_version ?? "—";
    return {
      total: allRows.length,
      calibrated,
      screens,
      legacy,
      completeEvidence,
      model,
    };
  }, [allRows]);

  const generatedAt = list.data?.generated_at ? new Date(list.data.generated_at) : null;
  const ageHours = generatedAt ? (Date.now() - generatedAt.getTime()) / 3_600_000 : null;
  const isStale = ageHours !== null && ageHours > 24;

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5 animate-fade-in">
        <PanelBoundary>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" /> Risk Intelligence
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                Evidence-gated risk screening with an auditable hash chain. A probability is shown only when an empirical calibration bin has sufficient observed samples; otherwise AICIS labels the value as an uncalibrated screening score and withholds output when required evidence is incomplete or stale.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider border rounded px-2 py-1",
                isStale ? "border-amber-500/30 text-amber-500" : "border-border text-muted-foreground",
              )}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isStale ? "bg-amber-500" : generatedAt ? "bg-emerald-500" : "bg-muted-foreground",
                )} />
                {generatedAt && ageHours !== null
                  ? isStale
                    ? `Stale ${Math.round(ageHours)}h`
                    : `Updated ${Math.round(ageHours)}h ago`
                  : "No issued batch"}
              </span>
              <Button
                onClick={() => list.refetch()}
                disabled={list.isFetching}
                size="sm"
                variant="outline"
                className="gap-2 h-8"
              >
                {list.isFetching
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
              {!rolesLoading && isAdmin && (
                <Button
                  onClick={() => infer.mutate()}
                  disabled={infer.isPending}
                  size="sm"
                  className="gap-2 h-8"
                >
                  {infer.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ShieldCheck className="h-3.5 w-3.5" />}
                  Run governed inference ({horizon}d)
                </Button>
              )}
            </div>
          </div>

          {!rolesLoading && !isAdmin && (
            <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Global inference generation is operator-controlled. Your session can inspect issued analytical output and provenance without receiving service-role write authority.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-5">
            <Card className="p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Sigma className="h-3 w-3" /> Issued
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-1">{stats.total}</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Database className="h-3 w-3" /> Empirical probabilities
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-primary mt-1">{stats.calibrated}</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Activity className="h-3 w-3" /> Screen scores
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-1">{stats.screens}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Evidence complete</div>
              <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                {stats.completeEvidence}/{stats.total}
              </div>
              {stats.legacy > 0 && (
                <div className="text-[9px] text-amber-600 mt-1">{stats.legacy} legacy semantics</div>
              )}
            </Card>
            <Card className="p-3 col-span-2 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Model identifier</div>
              <div className="text-sm font-mono font-semibold mt-1 truncate" title={stats.model}>{stats.model}</div>
              <div className="text-[9px] text-muted-foreground mt-1">fixed screening rule unless proven otherwise</div>
            </Card>
          </div>

          <Tabs value={horizon} onValueChange={setHorizon} className="mt-5">
            <TabsList className="bg-muted/50">
              {HORIZONS.map((item) => (
                <TabsTrigger key={item.key} value={item.key} className="gap-2 text-xs data-[state=active]:bg-card">
                  <Calendar className="h-3.5 w-3.5" /> {item.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {HORIZONS.map((item) => (
              <TabsContent key={item.key} value={item.key} className="space-y-3 mt-4">
                {domains.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setDomainFilter("all")}
                      className={cn(
                        "text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition",
                        domainFilter === "all"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      All ({allRows.length})
                    </button>
                    {domains.map((domain) => {
                      const count = allRows.filter((row) => row.domain === domain).length;
                      return (
                        <button
                          key={domain}
                          onClick={() => setDomainFilter(domain)}
                          className={cn(
                            "text-[10px] uppercase tracking-wide px-2 py-1 rounded border transition capitalize",
                            domainFilter === domain
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {domain.replace(/_/g, " ")} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}

                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      Ranked analytical signals · {item.label}
                      {domainFilter !== "all" && (
                        <span className="ml-2 text-xs text-muted-foreground capitalize">
                          / {domainFilter.replace(/_/g, " ")}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {list.isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : rows.length === 0 ? (
                      <div className="py-10 text-center space-y-2">
                        <Brain className="h-8 w-8 mx-auto text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                          No issued analytical output for the {item.label} horizon{domainFilter !== "all" ? ` in ${domainFilter}` : ""}.
                        </p>
                        <p className="text-xs text-muted-foreground max-w-lg mx-auto">
                          Absence is not converted into a zero-risk claim. AICIS may have withheld inference because required evidence was unavailable or stale.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {rows.map((row, index) => {
                          const semantics = scoreSemantics(row);
                          const score = displayScore(row);
                          const hasEmpiricalInterval =
                            semantics === "calibrated" &&
                            row.interval_semantics === "wilson_95_empirical_calibration_bin_rate" &&
                            row.prediction_interval_lower !== null &&
                            row.prediction_interval_upper !== null;
                          const lower = hasEmpiricalInterval ? Number(row.prediction_interval_lower) : null;
                          const upper = hasEmpiricalInterval ? Number(row.prediction_interval_upper) : null;
                          const sourceDate = formatSourceDate(row.source_snapshot_date);

                          return (
                            <div key={row.id} className="px-4 py-3 hover:bg-muted/30 transition flex items-center gap-3">
                              <span className="text-[11px] font-mono text-muted-foreground w-8 shrink-0 tabular-nums">#{index + 1}</span>
                              <span className="text-sm font-mono font-semibold w-12 shrink-0">{row.country_iso3}</span>
                              <span className="text-sm capitalize w-24 shrink-0 text-muted-foreground truncate">
                                {row.domain.replace(/_/g, " ")}
                              </span>
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                                    {semanticsLabel(row)}
                                  </Badge>
                                  {row.calibration_status === "insufficient_sample" && (
                                    <span className="text-[10px] text-amber-600">
                                      calibration sample insufficient{row.calibration_sample_size !== null && row.calibration_sample_size !== undefined ? ` (n=${row.calibration_sample_size})` : ""}
                                    </span>
                                  )}
                                  {row.calibration_status === "not_available" && (
                                    <span className="text-[10px] text-muted-foreground">no empirical calibration bin</span>
                                  )}
                                  {semantics === "legacy" && (
                                    <span className="text-[10px] text-amber-600">historical semantics not proven</span>
                                  )}
                                </div>

                                {score !== null && (
                                  <div className="relative h-1 bg-muted rounded-full overflow-hidden">
                                    {hasEmpiricalInterval && lower !== null && upper !== null && (
                                      <div
                                        className="absolute h-full bg-muted-foreground/30"
                                        style={{
                                          left: `${Math.max(0, lower) * 100}%`,
                                          width: `${Math.max(0, upper - lower) * 100}%`,
                                        }}
                                      />
                                    )}
                                    <div
                                      className={cn(
                                        "absolute top-1/2 -translate-y-1/2 h-2 w-2 rounded-full",
                                        score >= 0.7 ? "bg-destructive" : score >= 0.5 ? "bg-amber-500" : "bg-primary",
                                      )}
                                      style={{ left: `calc(${Math.max(0, Math.min(1, score)) * 100}% - 4px)` }}
                                    />
                                  </div>
                                )}

                                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[10px] text-muted-foreground font-mono tabular-nums">
                                  {row.raw_score !== null && Number.isFinite(Number(row.raw_score)) && (
                                    <span>raw screen {Number(row.raw_score).toFixed(3)}</span>
                                  )}
                                  {hasEmpiricalInterval && lower !== null && upper !== null ? (
                                    <>
                                      <span>·</span>
                                      <span>
                                        empirical-bin Wilson 95% [{(lower * 100).toFixed(0)}–{(upper * 100).toFixed(0)}%]
                                        {row.calibration_sample_size !== null && row.calibration_sample_size !== undefined ? ` · n=${row.calibration_sample_size}` : ""}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span>·</span>
                                      <span>empirical interval unavailable</span>
                                    </>
                                  )}
                                  {sourceDate && (
                                    <>
                                      <span>·</span>
                                      <span>evidence {sourceDate}</span>
                                    </>
                                  )}
                                  {row.audit_hash && (
                                    <>
                                      <span>·</span>
                                      <span title={row.audit_hash}>audit {row.audit_hash.slice(0, 8)}…</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <Badge variant="outline" className={`text-[11px] font-mono tabular-nums ${scoreClass(score)}`}>
                                {score === null ? "unknown" : `${(score * 100).toFixed(0)}%`}
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
        </PanelBoundary>
      </div>
    </AICISLayout>
  );
}
