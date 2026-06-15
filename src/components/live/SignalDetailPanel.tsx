import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, TrendingUp, Clock, Globe, ExternalLink,
  Shield, Zap, FileText, Plus, Eye, ArrowRight, X,
  CheckCircle2, XCircle, HelpCircle, BookOpen, Building2, Cpu, Route
} from "lucide-react";
import type { GlobalSignal } from "@/hooks/useGlobalSignals";
import { trustTierLabel, trustTierColor, enrichmentStatusLabel, enrichmentStatusColor } from "@/hooks/useGlobalSignals";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { EvidenceSection } from "@/components/evidence/EvidenceSection";

type AudienceMode = "government" | "media" | "business" | "public";

function scoreBar(score: number, label: string) {
  const color = score >= 80 ? "bg-red-500" : score >= 60 ? "bg-amber-500" : score >= 40 ? "bg-yellow-500" : "bg-muted-foreground";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold">{score}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export function SignalDetailPanel({
  signal, audienceMode, onClose,
}: {
  signal: GlobalSignal;
  audienceMode: AudienceMode;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const createDecision = async () => {
    const domain = signal.category === "public_health" ? "health" :
      signal.category === "defense_conflict" ? "security" :
      signal.category === "economic" || signal.category === "financial_markets" ? "economy" :
      signal.category === "energy" ? "energy" : "governance";

    const { error } = await supabase.from("decision_outcome_log").insert({
      signal_title: `[SIGNAL] ${signal.title}`,
      signal_id: signal.id,
      signal_date: new Date().toISOString().split("T")[0],
      domain,
      action_taken: false,
      evidence_type: "hypothetical",
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Decision created", description: "Routed to Decisions Inbox" });
    }
  };

  const submitFeedback = async (feedback: "confirmed" | "rejected" | "unclear") => {
    const { error } = await supabase.from("signal_routing_feedback").insert({
      signal_id: signal.id,
      feedback,
      category_correct: feedback === "confirmed",
      impact_appropriate: feedback === "confirmed",
      routing_appropriate: feedback !== "rejected",
      reviewer_notes: feedbackNotes || null,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setFeedbackSent(true);
      toast({ title: "Feedback recorded", description: `Signal marked as ${feedback}` });
    }
  };

  const audiences: AudienceMode[] = ["government", "media", "business", "public"];
  const isPending = signal.enrichment_status === "pending_enrichment" || signal.enrichment_status === "enriching";

  return (
    <Card className="h-full border-l flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">Signal Detail</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        <div className="space-y-4">
          <h2 className="text-base font-semibold leading-tight">{signal.title}</h2>

          {/* Trust, Confirmation & Enrichment badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {signal.official_source_present && (
              <Badge variant="outline" className="text-[10px] h-5 border-blue-500/30 bg-blue-500/10 text-blue-400">
                <Building2 className="h-2.5 w-2.5 mr-0.5" /> Official Source
              </Badge>
            )}
            {signal.source_trust_tier && signal.source_trust_tier !== "unknown" && (
              <Badge variant="outline" className={cn("text-[10px] h-5 border", trustTierColor(signal.source_trust_tier))}>
                {trustTierLabel(signal.source_trust_tier)} Source
              </Badge>
            )}
            {signal.multi_source_confirmed && (
              <Badge variant="outline" className="text-[10px] h-5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Multi-Source Confirmed
              </Badge>
            )}
            {signal.source_count > 1 && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {signal.source_count} sources
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-[9px] h-4", enrichmentStatusColor(signal.enrichment_status))}>
              <Cpu className="h-2 w-2 mr-0.5" /> {enrichmentStatusLabel(signal.enrichment_status)}
            </Badge>
          </div>

          {/* Canonical source */}
          {signal.canonical_source_name && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" />
              Canonical: <span className="font-semibold">{signal.canonical_source_name}</span>
              {signal.merged_source_count > 1 && (
                <span>({signal.merged_source_count} merged)</span>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{signal.summary}</p>

          {/* Scores — only if enriched */}
          {!isPending && (
            <div className="space-y-2">
              {scoreBar(signal.impact_score, "Impact")}
              {scoreBar(signal.confidence_score, "Confidence")}
              {scoreBar(signal.urgency_score, "Urgency")}
              {scoreBar(signal.misinformation_risk || 0, "Misinfo Risk")}
            </div>
          )}

          {isPending && (
            <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-2 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5" />
              This signal is awaiting AI enrichment. Scores and recommendations will appear after processing.
            </div>
          )}

          <Separator />

          {/* Routing Info */}
          {signal.routing_score > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold flex items-center gap-1">
                <Route className="h-3 w-3 text-primary" /> Routing
              </h4>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <div>Score: <span className="font-mono font-bold">{Math.round(signal.routing_score)}</span></div>
                <div>Routed: <span className="font-mono font-bold">{signal.routed_at ? "Yes" : "No"}</span></div>
                {signal.routing_suppressed_reason && (
                  <div className="col-span-2 text-amber-400">
                    Suppressed: {signal.routing_suppressed_reason}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Impact Reasoning */}
          {signal.impact_reasoning && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold flex items-center gap-1">
                <BookOpen className="h-3 w-3 text-blue-400" /> Impact Reasoning
              </h4>
              <p className="text-xs text-muted-foreground bg-blue-500/5 border border-blue-500/10 rounded p-2">
                {signal.impact_reasoning}
              </p>
            </div>
          )}

          {signal.strategic_implications && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold flex items-center gap-1">
                <Zap className="h-3 w-3 text-primary" /> Why It Matters
              </h4>
              <p className="text-xs text-muted-foreground">{signal.strategic_implications}</p>
            </div>
          )}

          {signal.likely_consequences && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold flex items-center gap-1">
                <ArrowRight className="h-3 w-3 text-amber-500" /> Likely Consequences
              </h4>
              <p className="text-xs text-muted-foreground">{signal.likely_consequences}</p>
            </div>
          )}

          <Separator />

          {/* Audience recommendations */}
          {!isPending && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold">Recommended Actions by Audience</h4>
              {audiences.map(aud => {
                const action = signal.recommended_actions?.[aud];
                if (!action) return null;
                return (
                  <div key={aud} className={cn(
                    "text-[11px] rounded px-2 py-1.5 border",
                    aud === audienceMode ? "bg-primary/10 border-primary/30" : "bg-muted/30 border-border/50"
                  )}>
                    <span className="font-semibold capitalize">{aud}:</span>{" "}
                    <span className="text-foreground/80">{action}</span>
                  </div>
                );
              })}
            </div>
          )}

          <Separator />

          {/* Affected */}
          <div className="space-y-2">
            {signal.affected_regions?.length > 0 && (
              <div>
                <h4 className="text-[10px] text-muted-foreground mb-1">Affected Regions</h4>
                <div className="flex flex-wrap gap-1">
                  {signal.affected_regions.map(r => (
                    <Badge key={r} variant="secondary" className="text-[9px] h-4">{r}</Badge>
                  ))}
                </div>
              </div>
            )}
            {signal.affected_countries?.length > 0 && (
              <div>
                <h4 className="text-[10px] text-muted-foreground mb-1">Countries</h4>
                <div className="flex flex-wrap gap-1">
                  {signal.affected_countries.map(c => (
                    <Badge key={c} variant="outline" className="text-[9px] h-4 font-mono">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {signal.affected_sectors?.length > 0 && (
              <div>
                <h4 className="text-[10px] text-muted-foreground mb-1">Sectors</h4>
                <div className="flex flex-wrap gap-1">
                  {signal.affected_sectors.map(s => (
                    <Badge key={s} variant="outline" className="text-[9px] h-4">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Sources */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold flex items-center gap-1">
              <FileText className="h-3 w-3" /> Sources ({signal.source_references?.length || 0})
            </h4>
            {signal.source_references?.map((s: any, i: number) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-2.5 w-2.5" />
                {s.name || "Source"} — {s.published ? new Date(s.published).toLocaleDateString() : ""}
              </a>
            ))}
          </div>

          <EvidenceSection
            mode="signal"
            signalId={signal.id}
            evidenceHash={signal.evidence_hash}
            defaultOpen
          />

          <Separator />

          {/* Routing Feedback */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold">Signal Quality Feedback</h4>
            {feedbackSent ? (
              <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Feedback recorded
              </div>
            ) : (
              <>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-[10px] flex-1" onClick={() => submitFeedback("confirmed")}>
                    <CheckCircle2 className="h-3 w-3 mr-0.5 text-emerald-400" /> Confirm
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] flex-1" onClick={() => submitFeedback("rejected")}>
                    <XCircle className="h-3 w-3 mr-0.5 text-red-400" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] flex-1" onClick={() => submitFeedback("unclear")}>
                    <HelpCircle className="h-3 w-3 mr-0.5 text-yellow-400" /> Unclear
                  </Button>
                </div>
                <Textarea
                  placeholder="Optional notes on classification quality..."
                  className="text-[11px] h-14 resize-none"
                  value={feedbackNotes}
                  onChange={e => setFeedbackNotes(e.target.value)}
                />
              </>
            )}
          </div>

          {/* Audit */}
          <div className="text-[9px] text-muted-foreground/60 font-mono space-y-0.5">
            <div>Model: {signal.model_version || "—"}</div>
            <div>Hash: {signal.evidence_hash?.slice(0, 16) || "—"}…</div>
            <div>Source: {signal.ingestion_source || "—"} | Rank: {signal.source_rank_score || 0}</div>
            <div>Ingested: {signal.ingested_at ? new Date(signal.ingested_at).toLocaleString() : "—"}</div>
            <div>Enriched: {signal.enriched_at ? new Date(signal.enriched_at).toLocaleString() : "—"}</div>
            <div>Routed: {signal.routed_at ? new Date(signal.routed_at).toLocaleString() : "—"}</div>
          </div>
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="p-3 border-t space-y-2">
        <Button size="sm" className="w-full h-8 text-xs" onClick={createDecision}>
          <Plus className="h-3 w-3 mr-1" /> Create Decision
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]">
            <Eye className="h-3 w-3 mr-1" /> Watchlist
          </Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]">
            <FileText className="h-3 w-3 mr-1" /> Add to Brief
          </Button>
        </div>
      </div>
    </Card>
  );
}
