import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, TrendingUp, Clock, Globe, ExternalLink, Shield, CheckCircle2, Building2, Loader2, XCircle, HelpCircle, ArrowRight } from "lucide-react";
import type { GlobalSignal } from "@/hooks/useGlobalSignals";
import { getSignalFreshness, freshnessColor, trustTierLabel, trustTierColor, enrichmentStatusLabel, enrichmentStatusColor } from "@/hooks/useGlobalSignals";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ScoreRelevanceButton, RelevanceCard, type RelevanceEvaluation } from "@/components/relevance/RelevanceCard";

const CATEGORY_LABELS: Record<string, string> = {
  geopolitical: "Geopolitical", economic: "Economic", financial_markets: "Financial Markets",
  central_banking: "Central Banking", public_health: "Public Health", climate_disaster: "Climate / Disaster",
  energy: "Energy", technology: "Technology", cybersecurity: "Cybersecurity",
  defense_conflict: "Defense / Conflict", legal_regulatory: "Legal / Regulatory",
  supply_chain: "Supply Chain", elections: "Elections", social_unrest: "Social Unrest",
  infrastructure: "Infrastructure",
};

const CATEGORY_COLORS: Record<string, string> = {
  geopolitical: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  economic: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  financial_markets: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  central_banking: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  public_health: "bg-red-500/20 text-red-400 border-red-500/30",
  climate_disaster: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  energy: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  technology: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  cybersecurity: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  defense_conflict: "bg-red-600/20 text-red-500 border-red-600/30",
  legal_regulatory: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  supply_chain: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  elections: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  social_unrest: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  infrastructure: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function scoreColor(score: number) {
  if (score >= 80) return "text-red-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-yellow-400";
  return "text-muted-foreground";
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type AudienceMode = "government" | "media" | "business" | "public";

export function SignalCard({
  signal, audienceMode, onSelect, selected, showFeedback = false, onFeedbackSubmitted,
}: {
  signal: GlobalSignal;
  audienceMode: AudienceMode;
  onSelect?: (signal: GlobalSignal) => void;
  selected?: boolean;
  showFeedback?: boolean;
  onFeedbackSubmitted?: () => void;
}) {
  const { toast } = useToast();
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [relevance, setRelevance] = useState<RelevanceEvaluation | null>(null);

  const catLabel = CATEGORY_LABELS[signal.category] || signal.category;
  const catColor = CATEGORY_COLORS[signal.category] || CATEGORY_COLORS.geopolitical;
  const recommendation = signal.recommended_actions?.[audienceMode] || signal.recommended_actions?.government || null;
  const isHighImpact = signal.impact_score >= 75;
  const freshness = getSignalFreshness(signal.first_detected_at);
  const tier = signal.source_trust_tier;
  const isPending = signal.enrichment_status === "pending_enrichment" || signal.enrichment_status === "enriching";

  const [submitting, setSubmitting] = useState(false);

  const submitFeedback = async (e: React.MouseEvent, feedback: "confirmed" | "rejected" | "unclear") => {
    e.stopPropagation();
    if (submitting || feedbackGiven) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("signal_routing_feedback").insert({
        signal_id: signal.id,
        feedback,
        category_correct: feedback === "confirmed",
        impact_appropriate: feedback === "confirmed",
        routing_appropriate: feedback !== "rejected",
      } as any);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        setFeedbackGiven(feedback);
        toast({ title: "Feedback recorded", description: `Marked as ${feedback}` });
        onFeedbackSubmitted?.();
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to submit feedback", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(false);

  const promoteTo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (promoting || promoted) return;
    setPromoting(true);
    try {
      const domain = signal.category === "public_health" ? "health" :
        signal.category === "defense_conflict" ? "security" :
        (signal.category === "economic" || signal.category === "financial_markets") ? "economy" :
        signal.category === "energy" ? "energy" : "governance";
      const { error } = await supabase.from("decision_outcome_log").insert({
        signal_title: `[SIGNAL] ${signal.title.slice(0, 500)}`,
        signal_id: signal.id,
        signal_date: new Date().toISOString().split("T")[0],
        domain,
        action_taken: false,
        evidence_type: "hypothetical",
      } as any);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        setPromoted(true);
        toast({ title: "Decision created", description: "Signal promoted to decision pipeline" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to promote signal", variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  };

  return (
    <Card
      className={cn(
        "p-3 sm:p-4 cursor-pointer transition-all border",
        selected ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/40",
        isHighImpact && "border-l-2 border-l-red-500"
      )}
      onClick={() => onSelect?.(signal)}
    >
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px] h-5 border", catColor)}>
              {catLabel}
            </Badge>
            {isHighImpact && (
              <Badge variant="destructive" className="text-[10px] h-5 animate-pulse">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> HIGH IMPACT
              </Badge>
            )}
            {signal.official_source_present && (
              <Badge variant="outline" className="text-[10px] h-5 border-blue-500/30 bg-blue-500/10 text-blue-400">
                <Building2 className="h-2.5 w-2.5 mr-0.5" /> Official
              </Badge>
            )}
            {signal.multi_source_confirmed && (
              <Badge variant="outline" className="text-[10px] h-5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> {signal.source_count}+ sources
              </Badge>
            )}
            {tier && tier !== "unknown" && (
              <Badge variant="outline" className={cn("text-[9px] h-4 border", trustTierColor(tier))}>
                {trustTierLabel(tier)}
              </Badge>
            )}
            {isPending && (
              <Badge variant="outline" className="text-[9px] h-4 border-blue-500/30 text-blue-400">
                <Loader2 className="h-2 w-2 mr-0.5 animate-spin" /> {enrichmentStatusLabel(signal.enrichment_status)}
              </Badge>
            )}
          </div>
          <span className={cn("text-[10px] flex items-center gap-0.5 shrink-0", freshnessColor(freshness))}>
            <Clock className="h-2.5 w-2.5" />
            {timeAgo(signal.first_detected_at)}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold leading-tight line-clamp-2">{signal.title}</h3>

        {/* Source provenance */}
        {signal.canonical_source_name && (
          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <ExternalLink className="h-2.5 w-2.5" />
            {signal.canonical_source_name}
            {signal.merged_source_count > 1 && (
              <span className="text-muted-foreground/60">+{signal.merged_source_count - 1} sources</span>
            )}
            {signal.ingestion_source && !signal.ingestion_source.startsWith("newsapi") && (
              <Badge variant="outline" className="text-[8px] h-3.5 ml-1">{signal.ingestion_source.replace("official_", "").toUpperCase()}</Badge>
            )}
          </div>
        )}

        {/* Summary */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {signal.normalized_summary || signal.summary}
        </p>

        {/* Scores — only show if enriched */}
        {!isPending && (
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-0.5">
              <TrendingUp className="h-3 w-3" />
              Impact: <span className={cn("font-bold", scoreColor(signal.impact_score))}>{signal.impact_score}</span>
            </span>
            <span className="flex items-center gap-0.5">
              <Shield className="h-3 w-3" />
              Conf: <span className="font-bold">{signal.confidence_score}</span>
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              Urgency: <span className={cn("font-bold", scoreColor(signal.urgency_score))}>{signal.urgency_score}</span>
            </span>
          </div>
        )}

        {/* Regions/Sectors */}
        {(signal.affected_regions?.length > 0 || signal.affected_sectors?.length > 0) && (
          <div className="flex items-center gap-1 flex-wrap">
            {signal.affected_regions?.slice(0, 3).map(r => (
              <Badge key={r} variant="secondary" className="text-[9px] h-4 px-1.5">
                <Globe className="h-2 w-2 mr-0.5" />{r}
              </Badge>
            ))}
            {signal.affected_sectors?.slice(0, 2).map(s => (
              <Badge key={s} variant="outline" className="text-[9px] h-4 px-1.5">{s}</Badge>
            ))}
          </div>
        )}

        {/* Audience-specific recommendation */}
        {recommendation && !isPending && (
          <div className="text-[11px] bg-primary/5 border border-primary/10 rounded px-2 py-1.5 mt-1">
            <span className="font-semibold text-primary capitalize">{audienceMode} action:</span>{" "}
            <span className="text-foreground/80">{recommendation}</span>
          </div>
        )}

        {/* Decision CTA — always visible for enriched signals */}
        {!isPending && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-border/30 mt-1">
            {showFeedback && !feedbackGiven && (
              <>
                <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5" disabled={submitting}
                  onClick={(e) => submitFeedback(e, "confirmed")}>
                  <CheckCircle2 className="h-3 w-3 mr-0.5 text-emerald-400" /> Confirm
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5" disabled={submitting}
                  onClick={(e) => submitFeedback(e, "rejected")}>
                  <XCircle className="h-3 w-3 mr-0.5 text-red-400" /> Reject
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5" disabled={submitting}
                  onClick={(e) => submitFeedback(e, "unclear")}>
                  <HelpCircle className="h-3 w-3 mr-0.5 text-yellow-400" /> Unclear
                </Button>
              </>
            )}
            {feedbackGiven && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                <CheckCircle2 className="h-3 w-3" /> {feedbackGiven}
              </span>
            )}
            <div className="flex-1" />
            {promoted ? (
              <span className="text-[9px] text-emerald-400 flex items-center gap-0.5">
                <CheckCircle2 className="h-3 w-3" /> Decision Created
              </span>
            ) : (
              <Button size="sm" variant="outline" className="h-6 text-[9px] px-2 gap-1 text-primary border-primary/30" disabled={promoting}
                onClick={promoteTo}>
                {promoting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                Create Decision
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
