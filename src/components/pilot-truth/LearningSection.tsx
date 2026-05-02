import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, RefreshCw, Loader2, TrendingUp, TrendingDown, Info } from "lucide-react";
import { toast } from "sonner";

type QualityRow = {
  intervention_type: string;
  total_proposed: number;
  executed_n: number;
  outcome_n: number;
  scored_n: number;
  success_n: number;
  avg_roi_realization: number | null;
  execution_rate: number;
  success_rate: number;
  dismissal_rate: number;
  sample_confidence: number;
  quality_score: number;
  score_explanation: string;
};

type LeaderRow = {
  scope: "intervention" | "country" | "domain";
  key: string;
  score: number;
  sample_size: number;
  detail: string;
};

type Adjustment = {
  intervention_type: string;
  quality_score: number;
  adjustment_multiplier: number;
  sample_size: number;
  rationale: string;
  computed_at: string;
};

const pct = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : `${(Number(n) * 100).toFixed(d)}%`;

export function LearningSection({ isPrivileged }: { isPrivileged: boolean }) {
  const qc = useQueryClient();

  const quality = useQuery({
    queryKey: ["recommendation-quality-score"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recommendation_quality_score" as any)
        .select("*")
        .order("quality_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QualityRow[];
    },
  });

  const leaderboard = useQuery({
    queryKey: ["risk-action-learning-leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_action_learning_leaderboard" as any)
        .select("*");
      if (error) throw error;
      return (data ?? []) as unknown as LeaderRow[];
    },
  });

  const adjustments = useQuery({
    queryKey: ["risk-action-score-adjustments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_action_score_adjustments")
        .select("*")
        .order("quality_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Adjustment[];
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("refresh_recommendation_quality_scores" as any);
      if (error) throw error;
      return data;
    },
    onSuccess: (rows: any) => {
      toast.success(`Recomputed ${(rows ?? []).length} intervention scores`);
      qc.invalidateQueries({ queryKey: ["recommendation-quality-score"] });
      qc.invalidateQueries({ queryKey: ["risk-action-learning-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["risk-action-score-adjustments"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const interventions = (quality.data ?? []).filter((r) => r.outcome_n > 0);
  const best = interventions.slice(0, 5);
  const worst = [...interventions].sort((a, b) => a.quality_score - b.quality_score).slice(0, 5);
  const noOutcomesYet = interventions.length === 0;

  const countries = (leaderboard.data ?? []).filter((r) => r.scope === "country");
  const domains = (leaderboard.data ?? []).filter((r) => r.scope === "domain");
  const topCountries = [...countries].sort((a, b) => b.score - a.score).slice(0, 5);
  const bottomCountries = [...countries].sort((a, b) => a.score - b.score).slice(0, 5);
  const topDomains = [...domains].sort((a, b) => b.score - a.score).slice(0, 5);

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-primary" />
            Action Learning Loop
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Learns from outcome-logged actions only. Raw confidence is preserved; the adjusted
            priority score is <span className="font-mono">confidence × learning_multiplier</span>.
            Every adjustment is explainable.
          </p>
        </div>
        {isPrivileged && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="gap-2 shrink-0"
          >
            {refresh.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Recompute scores
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {(quality.isLoading || leaderboard.isLoading) && <Skeleton className="h-32 w-full" />}

        {!quality.isLoading && noOutcomesYet && (
          <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              No outcome-logged actions yet. The learning loop activates once operators record at
              least one outcome via the Lifecycle Queue above. Until then, all interventions hold a
              neutral 1.0× multiplier and raw rankings are unchanged.
            </div>
          </div>
        )}

        {/* Adjustments table — always shown so the audit trail is visible */}
        {adjustments.data && adjustments.data.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active learning adjustments ({adjustments.data.length})
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Intervention type</th>
                    <th className="text-right px-3 py-2">Quality</th>
                    <th className="text-right px-3 py-2">Multiplier</th>
                    <th className="text-right px-3 py-2">n</th>
                    <th className="text-left px-3 py-2">Rationale (audit-visible)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {adjustments.data.map((a) => {
                    const dir =
                      a.adjustment_multiplier > 1.05
                        ? "boost"
                        : a.adjustment_multiplier < 0.95
                        ? "reduce"
                        : "neutral";
                    return (
                      <tr key={a.intervention_type} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium">{a.intervention_type}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{pct(a.quality_score, 1)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          <Badge
                            variant="outline"
                            className={
                              dir === "boost"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                                : dir === "reduce"
                                ? "bg-destructive/10 text-destructive border-destructive/30"
                                : ""
                            }
                          >
                            {a.adjustment_multiplier.toFixed(2)}×
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{a.sample_size}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{a.rationale}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Best vs worst interventions */}
        {!noOutcomesYet && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <LeaderColumn
              title="Best-performing interventions"
              icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-600" />}
              rows={best.map((r) => ({
                key: r.intervention_type,
                score: r.quality_score,
                detail: r.score_explanation,
              }))}
              tone="positive"
            />
            <LeaderColumn
              title="Worst-performing interventions"
              icon={<TrendingDown className="h-3.5 w-3.5 text-destructive" />}
              rows={worst.map((r) => ({
                key: r.intervention_type,
                score: r.quality_score,
                detail: r.score_explanation,
              }))}
              tone="negative"
            />
          </div>
        )}

        {/* Domains and countries */}
        {(topDomains.length > 0 || topCountries.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <LeaderColumn
              title="Domains with highest action success"
              icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-600" />}
              rows={topDomains.map((r) => ({ key: r.key, score: r.score, detail: r.detail }))}
              tone="positive"
            />
            <LeaderColumn
              title="Countries — strongest ROI realization"
              icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-600" />}
              rows={topCountries.map((r) => ({ key: r.key, score: r.score, detail: r.detail }))}
              tone="positive"
              suffix="x"
            />
            <LeaderColumn
              title="Countries — weakest ROI realization"
              icon={<TrendingDown className="h-3.5 w-3.5 text-destructive" />}
              rows={bottomCountries.map((r) => ({ key: r.key, score: r.score, detail: r.detail }))}
              tone="negative"
              suffix="x"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LeaderColumn({
  title,
  icon,
  rows,
  tone,
  suffix,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { key: string; score: number; detail: string }[];
  tone: "positive" | "negative";
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold mb-2">
        {icon}
        <span>{title}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">No data yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.key}</div>
                <div className="text-[10px] text-muted-foreground truncate">{r.detail}</div>
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 font-mono text-[10px] ${
                  tone === "positive"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                    : "bg-destructive/10 text-destructive border-destructive/30"
                }`}
              >
                {suffix === "x" ? `${Number(r.score).toFixed(2)}x` : pct(r.score, 0)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
