import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ThumbsUp, ThumbsDown, CheckCircle2, EyeOff, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface MatchContributor {
  kind: string;
  label: string;
  weight: number;
  matched?: string[];
}

export interface RelevanceEvaluation {
  evaluation_id?: string;
  relevance_score: number;
  relevance_tier: string;
  explanation: string;
  why_this_matters: string;
  recommended_action: string;
  confidence_score: number | null;
  model_used: string;
  prompt_version: string;
  notice?: string | null;
  match_contributors?: MatchContributor[];
}

interface SignalLike {
  id?: string;
  title?: string;
  summary?: string;
  normalized_summary?: string;
  source?: string;
  country?: string;
  category?: string;
  domain?: string;
  severity?: string | number;
  impact_score?: number;
  confidence_score?: number;
  affected_regions?: string[];
  affected_sectors?: string[];
}

const tierColor: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/40",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  moderate: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  noise: "bg-muted text-muted-foreground border-border",
};

export function ScoreRelevanceButton({
  signal,
  organizationContext,
  organizationId,
  onScored,
  size = "sm",
}: {
  signal: SignalLike;
  organizationContext?: Record<string, unknown>;
  organizationId?: string | null;
  onScored?: (e: RelevanceEvaluation) => void;
  size?: "sm" | "default";
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handle = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("score-relevance", {
        body: {
          signal: {
            signal_id: signal.id,
            signal_title: signal.title,
            signal_summary: signal.normalized_summary || signal.summary,
            source: signal.source,
            country: signal.country || signal.affected_regions?.[0],
            domain: signal.domain || signal.category,
            severity: signal.severity ?? signal.impact_score,
            confidence: signal.confidence_score,
            affected_entities: signal.affected_regions || [],
          },
          organization_id: organizationId || null,
          organization_context: organizationContext || {},
        },
      });
      if (error) throw error;
      if (!data?.ok && data?.error) throw new Error(data.error);
      onScored?.(data as RelevanceEvaluation);
      if (data?.notice) {
        toast({ title: "Relevance scored", description: data.notice });
      } else {
        toast({ title: "Relevance scored", description: `Score ${data.relevance_score} • ${data.relevance_tier}` });
      }
    } catch (err) {
      toast({
        title: "Scoring failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size={size} variant="outline" onClick={handle} disabled={loading} className="gap-1">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      Score Relevance
    </Button>
  );
}

export function RelevanceCard({ evaluation }: { evaluation: RelevanceEvaluation }) {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isFallback = evaluation.model_used?.startsWith("fallback");

  const submit = async (value: "useful" | "not_useful" | "acted_on" | "ignored") => {
    if (!evaluation.evaluation_id || submitting) return;
    setSubmitting(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("aicis_relevance_evaluations")
        .update({
          user_feedback: value,
          feedback_at: new Date().toISOString(),
          feedback_user_id: userRes.user?.id ?? null,
        } as any)
        .eq("id", evaluation.evaluation_id);
      if (error) throw error;
      setFeedback(value);
      toast({ title: "Feedback saved", description: value });
    } catch (err) {
      toast({
        title: "Could not save feedback",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const tierCls = tierColor[evaluation.relevance_tier] || tierColor.noise;
  const confidenceLabel = evaluation.confidence_score === null || evaluation.confidence_score === undefined
    ? "Unknown"
    : String(evaluation.confidence_score);

  return (
    <Card className="p-4 space-y-3 border-primary/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AICIS Relevance</span>
          <Badge variant="outline" className={cn("text-[10px] uppercase", tierCls)}>
            {evaluation.relevance_tier}
          </Badge>
        </div>
        <div className="text-2xl font-bold tabular-nums">{evaluation.relevance_score}<span className="text-xs text-muted-foreground">/100</span></div>
      </div>

      {(isFallback || evaluation.notice) && (
        <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 border border-border/50 rounded px-2 py-1.5">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{evaluation.notice || "Using fallback relevance scoring. Connect model endpoint for AI scoring."}</span>
        </div>
      )}

      <div className="space-y-2 text-xs">
        <div>
          <div className="text-muted-foreground uppercase text-[10px] tracking-wide mb-0.5">Why this matters</div>
          <p className="text-foreground/90">{evaluation.why_this_matters}</p>
        </div>
        <div>
          <div className="text-muted-foreground uppercase text-[10px] tracking-wide mb-0.5">Recommended action</div>
          <p className="text-foreground/90">{evaluation.recommended_action}</p>
        </div>
        {evaluation.explanation && (
          <div className="text-[11px] text-muted-foreground italic">{evaluation.explanation}</div>
        )}
        {evaluation.match_contributors && evaluation.match_contributors.length > 0 && (
          <div>
            <div className="text-muted-foreground uppercase text-[10px] tracking-wide mb-1">Score contributors</div>
            <div className="flex flex-wrap gap-1">
              {evaluation.match_contributors.map((c, i) => (
                <Badge
                  key={`${c.kind}-${i}`}
                  variant="outline"
                  className="text-[10px] gap-1"
                  title={c.matched?.join(", ")}
                >
                  {c.label}
                  <span className="text-primary font-semibold">+{c.weight}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground">
          Confidence: <span className="font-semibold text-foreground">{confidenceLabel}</span> •{" "}
          {evaluation.model_used}
        </span>
        <div className="flex items-center gap-1">
          {feedback ? (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> {feedback}
            </span>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="h-6 px-1.5" disabled={submitting} onClick={() => submit("useful")}>
                <ThumbsUp className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5" disabled={submitting} onClick={() => submit("not_useful")}>
                <ThumbsDown className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={submitting} onClick={() => submit("acted_on")}>
                <CheckCircle2 className="h-3 w-3 mr-0.5" /> Acted
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={submitting} onClick={() => submit("ignored")}>
                <EyeOff className="h-3 w-3 mr-0.5" /> Ignored
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
