import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, RefreshCw, Check, X, PlayCircle, Clock, Coins } from "lucide-react";
import { toast } from "sonner";

interface Rec {
  id: string;
  country_iso3: string;
  domain: string;
  risk_probability: number;
  rank_position: number;
  intervention_type: string;
  intervention_title: string;
  rationale_md: string;
  responsible_domain: string;
  urgency_window: string;
  urgency_hours: number;
  estimated_roi_eur: number;
  estimated_cost_eur: number;
  confidence: number;
  status: string;
  generated_at: string;
}

const urgencyClass = (u: string) =>
  u === "24h" ? "bg-destructive/15 text-destructive border-destructive/30" :
  u === "72h" ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
  u === "7d"  ? "bg-primary/10 text-primary border-primary/20" :
                "bg-muted text-muted-foreground border-border";

const statusClass = (s: string) =>
  s === "executed"  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" :
  s === "accepted"  ? "bg-primary/15 text-primary border-primary/30" :
  s === "dismissed" ? "bg-muted text-muted-foreground border-border" :
                      "bg-amber-500/10 text-amber-600 border-amber-500/30";

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

interface Props {
  compact?: boolean;
  topN?: number;
}

export const RecommendedActionsPanel = ({ compact = false, topN = 50 }: Props) => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const list = useQuery({
    queryKey: ["risk-action-recs", filter, topN],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-risk-actions", {
        body: { mode: "list", limit: topN, ...(filter !== "all" ? { status: filter } : {}) },
      });
      if (error) throw error;
      return data as { rows: Rec[]; generated_at: string | null };
    },
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-risk-actions", {
        body: { mode: "generate", top_n: 50 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Generated ${d?.generated ?? 0} recommended actions`);
      qc.invalidateQueries({ queryKey: ["risk-action-recs"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-risk-actions", {
        body: { mode: "update", id, status },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(`Action ${vars.status}`);
      qc.invalidateQueries({ queryKey: ["risk-action-recs"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const rows = list.data?.rows ?? [];
  const totalRoi = rows.filter(r => r.status === "proposed" || r.status === "accepted")
    .reduce((s, r) => s + Number(r.estimated_roi_eur || 0), 0);

  return (
    <Card className="border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Target className="h-4 w-4 text-primary shrink-0" />
            <h3 className="text-sm font-semibold truncate">Recommended Actions</h3>
            <Badge variant="outline" className="text-[10px] font-mono">{rows.length}</Badge>
            {totalRoi > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                <Coins className="h-3 w-3" /> {fmtEur(totalRoi)} potential
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {!compact && (
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-7 text-[11px] rounded-md border border-border bg-background px-2"
              >
                <option value="all">All</option>
                <option value="proposed">Proposed</option>
                <option value="accepted">Accepted</option>
                <option value="executed">Executed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Generate
            </Button>
          </div>
        </div>

        {list.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No actions yet. Click <span className="font-mono">Generate</span> to create recommendations from the latest risk ranking.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.slice(0, compact ? 5 : rows.length).map((r) => (
              <div key={r.id} className="rounded-md border border-border p-3 hover:bg-muted/30 transition">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">#{r.rank_position}</span>
                      <span className="text-xs font-mono font-semibold">{r.country_iso3}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{r.domain}</Badge>
                      <Badge variant="outline" className={`text-[10px] font-mono gap-1 ${urgencyClass(r.urgency_window)}`}>
                        <Clock className="h-2.5 w-2.5" /> {r.urgency_window}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] capitalize ${statusClass(r.status)}`}>
                        {r.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium mt-1.5">{r.intervention_title}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <span title="Risk probability">Risk {Math.round(Number(r.risk_probability) * 100)}%</span>
                      <span title="Confidence">Conf {Math.round(Number(r.confidence) * 100)}%</span>
                      <span className="text-emerald-600" title="Estimated ROI">+{fmtEur(Number(r.estimated_roi_eur))}</span>
                      <span className="text-muted-foreground" title="Intervention cost">−{fmtEur(Number(r.estimated_cost_eur))}</span>
                    </div>
                  </div>
                  {r.status === "proposed" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: r.id, status: "accepted" })}
                        disabled={update.isPending}
                      ><Check className="h-3 w-3" /> Accept</Button>
                      <Button
                        size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: r.id, status: "dismissed" })}
                        disabled={update.isPending}
                      ><X className="h-3 w-3" /></Button>
                    </div>
                  )}
                  {r.status === "accepted" && (
                    <Button
                      size="sm" variant="default" className="h-7 text-[11px] gap-1 shrink-0"
                      onClick={() => update.mutate({ id: r.id, status: "executed" })}
                      disabled={update.isPending}
                    ><PlayCircle className="h-3 w-3" /> Execute</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
