import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldCheck, ShieldAlert, Loader2, Lock, Unlock } from "lucide-react";
import { CitationChipList, type Citation } from "@/components/sovereign/CitationChip";

interface TrustScore {
  signal_citations_pct: number;
  warning_citations_pct: number;
  recommendation_citations_pct: number;
  official_source_pct: number;
  chain_integrity_pct: number;
  weighted_score: number;
  gate_status: "BLOCKED" | "NEAR_READY" | "PASSED";
  hard_fail_eligible: boolean;
  signals_total: number;
  signals_cited: number;
  warnings_total: number;
  warnings_cited: number;
  recs_total: number;
  recs_cited: number;
  citations_total: number;
  citations_official: number;
  chain_total: number;
  chain_present: number;
  computed_at: string;
}

const WEIGHTS = [
  { key: "signal_citations_pct",         label: "Signal Citations",         weight: 40, num: "signals_cited",    den: "signals_total"   },
  { key: "warning_citations_pct",        label: "Warning Citations",        weight: 20, num: "warnings_cited",   den: "warnings_total"  },
  { key: "recommendation_citations_pct", label: "Recommendation Citations", weight: 20, num: "recs_cited",       den: "recs_total"      },
  { key: "official_source_pct",          label: "Official Source Match",    weight: 10, num: "citations_official", den: "citations_total" },
  { key: "chain_integrity_pct",          label: "Citation Chain Integrity", weight: 10, num: "chain_present",    den: "chain_total"     },
] as const;

function gateBadge(status: TrustScore["gate_status"]) {
  if (status === "PASSED")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">PASSED</Badge>;
  if (status === "NEAR_READY")
    return <Badge className="bg-amber-600 hover:bg-amber-600">NEAR_READY</Badge>;
  return <Badge variant="destructive">BLOCKED</Badge>;
}

export default function TrustCompletionScorePanel() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["trust-completion-score"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compute_trust_completion_score" as any);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as TrustScore;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Trust Completion Score
            </CardTitle>
            <CardDescription>
              Proof Is The Product — gate must reach <strong>95</strong> before <code className="font-mono text-xs">soft_fail → hard_fail</code>.
            </CardDescription>
          </div>
          {data && gateBadge(data.gate_status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Computing score…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Failed to compute score</AlertTitle>
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}

        {data && (
          <>
            {/* Headline score */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Weighted Score</div>
                <div className="text-5xl font-bold font-mono tabular-nums">
                  {data.weighted_score.toFixed(2)}
                  <span className="text-2xl text-muted-foreground"> / 100</span>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Gate Status:</span>
                  {gateBadge(data.gate_status)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Hard Fail Eligible:</span>
                  {data.hard_fail_eligible ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600"><Unlock className="h-3 w-3 mr-1" />YES</Badge>
                  ) : (
                    <Badge variant="outline"><Lock className="h-3 w-3 mr-1" />NO</Badge>
                  )}
                </div>
              </div>
            </div>

            <Progress value={Math.min(100, data.weighted_score)} className="h-3" />

            {/* Component breakdown */}
            <div className="space-y-3">
              {WEIGHTS.map((w) => {
                const pct = Number(data[w.key as keyof TrustScore]) || 0;
                const num = Number(data[w.num as keyof TrustScore]) || 0;
                const den = Number(data[w.den as keyof TrustScore]) || 0;
                const contribution = (pct * w.weight) / 100;
                return (
                  <div key={w.key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{w.label}</span>
                        <Badge variant="outline" className="font-mono text-xs">{w.weight}%</Badge>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground tabular-nums">
                        {num.toLocaleString()} / {den.toLocaleString()} ·{" "}
                        <span className="text-foreground">{pct.toFixed(2)}%</span> ·{" "}
                        contributes <span className="text-foreground">{contribution.toFixed(2)}</span>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                );
              })}
            </div>

            {/* Doctrine rule */}
            <Alert className={data.hard_fail_eligible ? "border-emerald-600/50" : ""}>
              {data.hard_fail_eligible ? (
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              <AlertTitle>
                {data.hard_fail_eligible
                  ? "Trust gate passed — hard_fail may be enabled"
                  : "Trust gate locked — soft_fail only"}
              </AlertTitle>
              <AlertDescription>
                Per doctrine, <code className="font-mono text-xs">citation_enforcement_policy</code> can only flip from
                {" "}<code className="font-mono text-xs">soft_fail</code> to
                {" "}<code className="font-mono text-xs">hard_fail</code> when the Trust Completion Score reaches
                {" "}<strong>95</strong>. Current: <strong>{data.weighted_score.toFixed(2)}</strong>.
              </AlertDescription>
            </Alert>

            <div className="text-xs text-muted-foreground text-right">
              Computed {new Date(data.computed_at).toLocaleTimeString()} · auto-refresh 60s
              {dataUpdatedAt ? ` · client refreshed ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
