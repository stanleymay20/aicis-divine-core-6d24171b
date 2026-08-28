import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRoles } from "@/hooks/useUserRoles";
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
  confidence: number | null;
  confidence_semantics?: string | null;
  urgency_score: number | null;
  impact_score: number | null;
  evidence_count: number | null;
  evidence_count_semantics?: string | null;
  input_signal_score?: number | null;
  input_signal_score_semantics?: string | null;
  source_identifier_count?: number | null;
  independent_origin_count?: number | null;
  source_independence_status?: string | null;
  source_independence_semantics?: string | null;
  suggested_time_to_action: string | null;
  generation_method: string;
  status: string;
  created_at: string;
}

const sevClass = (severity: string) =>
  severity === "critical" ? "bg-destructive/15 text-destructive border-destructive/30" :
  severity === "high" ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
  severity === "medium" ? "bg-primary/10 text-primary border-primary/20" :
  "bg-muted text-muted-foreground border-border";

const independenceLabel = (row: SigRec) => {
  if (row.source_independence_status === "established" && row.independent_origin_count != null) {
    return `Independent origins ${row.independent_origin_count}`;
  }
  return "Source independence not established";
};

export const SignalRecommendationsLane = ({ topN = 25 }: { topN?: number }) => {
  const queryClient = useQueryClient();
  const { isAdmin, isOperator, isLoading: rolesLoading } = useUserRoles();

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
      return (data ?? []) as unknown as SigRec[];
    },
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error("Administrator access is required to run global recommendation generation.");
      const { data, error } = await supabase.functions.invoke("generate-signal-recommendations", {
        body: { limit: 100, ai_budget: 5 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: { created?: number; notifications_queued?: number } | null) => {
      toast.success(`Created ${data?.created ?? 0} recommendations · queued ${data?.notifications_queued ?? 0}`);
      queryClient.invalidateQueries({ queryKey: ["signal-recs"] });
    },
    onError: (error) => toast.error(String(error)),
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (!isOperator) throw new Error("Operator or administrator access is required.");
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
    onSuccess: (_, variables) => {
      toast.success(`Marked ${variables.status}`);
      queryClient.invalidateQueries({ queryKey: ["signal-recs"] });
    },
    onError: (error) => toast.error(String(error)),
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
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => generate.mutate()}
              disabled={generate.isPending || rolesLoading}
            >
              {generate.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              Generate governed recommendations
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Recommendations are advisory workflow artifacts. No calibrated recommendation confidence is issued; inspect the signal evidence screen and source-independence status separately.
        </p>

        {list.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No pending signal recommendations.
            {isAdmin ? " Run the governed generator to scan eligible canonical signals." : ""}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-md border border-border p-3 hover:bg-muted/30 transition">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-[10px] font-mono uppercase ${sevClass(row.severity)}`}>
                        {row.severity}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {row.category.replace(/_/g, " ")}
                      </Badge>
                      {row.suggested_time_to_action && (
                        <Badge variant="outline" className="text-[10px] font-mono gap-1">
                          <Clock className="h-2.5 w-2.5" /> {row.suggested_time_to_action}
                        </Badge>
                      )}
                      {row.affected_countries?.slice(0, 4).map((country) => (
                        <span key={country} className="text-[10px] font-mono text-muted-foreground">{country}</span>
                      ))}
                      {row.generation_method.startsWith("ai:") && (
                        <Badge variant="outline" className="text-[10px] gap-1 bg-primary/5">AI-refined</Badge>
                      )}
                    </div>

                    <p className="text-sm font-medium mt-1.5">{row.recommended_action}</p>
                    {row.rationale && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{row.rationale}</p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <span>Recommendation confidence: not calibrated</span>
                      {row.input_signal_score != null && (
                        <span>Signal evidence screen {Math.round(row.input_signal_score)}/100</span>
                      )}
                      {row.urgency_score != null && <span>Urg {row.urgency_score}</span>}
                      {row.impact_score != null && <span>Impact {row.impact_score}</span>}
                      <span>{independenceLabel(row)}</span>
                      {row.source_identifier_count != null && (
                        <span>Source identifiers {row.source_identifier_count}</span>
                      )}
                    </div>
                  </div>

                  {row.status === "pending_review" && isOperator && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: row.id, status: "reviewed" })}
                        disabled={update.isPending}
                      >
                        <Check className="h-3 w-3" /> Review
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: row.id, status: "escalated" })}
                        disabled={update.isPending}
                      >
                        <AlertTriangle className="h-3 w-3" /> Escalate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => update.mutate({ id: row.id, status: "dismissed" })}
                        disabled={update.isPending}
                      >
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