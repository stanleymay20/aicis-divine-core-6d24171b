import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, RefreshCw, Check, X, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";

interface SigRec {
  id: string;
  signal_id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  affected_countries: string[];
  affected_sectors: string[];
  recommended_action: string;
  rationale: string | null;
  confidence: number;
  urgency_score: number | null;
  impact_score: number | null;
  evidence_count: number;
  suggested_time_to_action: string | null;
  generation_method: string;
  status: string;
  created_at: string;
}

const sevClass = (s: string) =>
  s === "critical" ? "bg-destructive/15 text-destructive border-destructive/30" :
  s === "high" ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
  s === "medium" ? "bg-primary/10 text-primary border-primary/20" :
  "bg-muted text-muted-foreground border-border";

export const SignalRecommendationsLane = ({ topN = 25 }: { topN?: number }) => {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["signal-recs", topN],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signal_action_recommendations")
        .select("*")
        .in("status", ["pending_review", "reviewed", "escalated"])
        .order("created_at", { ascending: false })
        .limit(topN);
      if (error) throw error;
      return (data ?? []) as SigRec[];
    },
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-signal-recommendations", {
        body: { limit: 100, ai_budget: 5 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`Created ${d?.created ?? 0} recommendations · queued ${d?.notifications_queued ?? 0}`);
      qc.invalidateQueries({ queryKey: ["signal-recs"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "reviewed") patch.reviewed_at = new Date().toISOString();
      if (status === "dismissed") patch.dismissed_at = new Date().toISOString();
      if (status === "escalated") patch.escalated_at = new Date().toISOString();
      const { error } = await supabase
        .from("signal_action_recommendations")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      toast.success(`Marked ${v.status}`);
      qc.invalidateQueries({ queryKey: ["signal-recs"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const rows = list.data ?? [];

  return (
    <Card className="border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <h3 className="text-sm font-semibold truncate">Signal Recommendations</h3>
            <Badge variant="outline" className="text-[10px] font-mono">{rows.length}</Badge>
          </div>
          <Button
            size="sm" variant="outline" className="h-7 text-xs gap-1.5"
            onClick={() => generate.mutate()} disabled={generate.isPending}
          >
            {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Generate
          </Button>
        </div>

        {list.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No pending signal recommendations. Click <span className="font-mono">Generate</span> to scan canonical signals.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-md border border-border p-3 hover:bg-muted/30 transition">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-[10px] font-mono uppercase ${sevClass(r.severity)}`}>{r.severity}</Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">{r.category.replace(/_/g, " ")}</Badge>
                      {r.suggested_time_to_action && (
                        <Badge variant="outline" className="text-[10px] font-mono gap-1">
                          <Clock className="h-2.5 w-2.5" /> {r.suggested_time_to_action}
                        </Badge>
                      )}
                      {r.affected_countries?.slice(0, 4).map((c) => (
                        <span key={c} className="text-[10px] font-mono text-muted-foreground">{c}</span>
                      ))}
                      {r.generation_method === "ai" && (
                        <Badge variant="outline" className="text-[10px] gap-1 bg-primary/5">AI</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1.5">{r.recommended_action}</p>
                    {r.rationale && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{r.rationale}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <span>Conf {Math.round(r.confidence * 100)}%</span>
                      {r.urgency_score != null && <span>Urg {r.urgency_score}</span>}
                      {r.impact_score != null && <span>Impact {r.impact_score}</span>}
                      <span>Evidence {r.evidence_count}</span>
                    </div>
                  </div>
                  {r.status === "pending_review" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: r.id, status: "reviewed" })} disabled={update.isPending}>
                        <Check className="h-3 w-3" /> Review
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: r.id, status: "escalated" })} disabled={update.isPending}>
                        <AlertTriangle className="h-3 w-3" /> Escalate
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: r.id, status: "dismissed" })} disabled={update.isPending}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
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
