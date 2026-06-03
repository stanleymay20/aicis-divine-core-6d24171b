import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { type Signal, type VisibilityTab } from "./types";
import { relevanceBadgeColor, sourceBadge, tierColor } from "./helpers";
import { FeedbackRow } from "./atoms";
import { WhyRelevantPanel, WhyTrustPanel } from "./WhyPanels";
import { TrustEvidence } from "@/components/sovereign/TrustEvidence";
import { useSubjectCitations } from "@/hooks/useSubjectCitations";

interface Props {
  signal: Signal;
  expanded: boolean;
  visibility: VisibilityTab;
  onToggleExpand: () => void;
  onFeedback: (type: string, context: any) => void;
  feedbackDisabled: boolean;
}

export function SignalRow({ signal: s, expanded, visibility, onToggleExpand, onFeedback, feedbackDisabled }: Props) {
  const badge = sourceBadge(s);
  const isRecovery = s.ingestion_source === "detection_audit_recovery";
  const isDupe = s.canonical_event_status === "duplicate";
  const conf = s.confidence_score ?? 0;
  const confColor = conf >= 75 ? "bg-emerald-500/15 text-emerald-300 border-emerald-700/50"
    : conf >= 50 ? "bg-sky-500/15 text-sky-300 border-sky-700/50"
    : "bg-amber-500/15 text-amber-300 border-amber-700/50";

  const citationsQ = useSubjectCitations("global_signals", [s.id], { enabled: expanded });
  const citations = citationsQ.data?.get(s.id);

  return (
    <div
      className={`rounded-md border p-3 transition-colors ${
        isRecovery ? "border-amber-700/40 bg-amber-500/5"
        : isDupe ? "border-border/40 bg-muted/10 opacity-75"
        : "border-border hover:border-muted-foreground/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium leading-snug">
            {s.translated_title || s.title}
          </h3>
          {s.translated_title && s.translated_title !== s.title && (
            <div className="text-[10px] text-muted-foreground mt-0.5 italic line-clamp-1">
              {s.source_language && <span className="uppercase font-mono mr-1">[{s.source_language}]</span>}
              {s.title}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          <Badge variant="outline" className={relevanceBadgeColor(s.relevance_tier) + " text-[10px] font-mono"} title={s.relevance_is_fallback ? "Fallback relevance estimate" : "Personalized relevance score"}>
            {s.relevance_tier}{typeof s.relevance_score === "number" ? ` ${s.relevance_score}` : ""}{s.relevance_is_fallback ? "*" : ""}
          </Badge>
          {s.source_language && s.source_language !== "en" && s.source_language !== "und" && (
            <Badge variant="outline" className="bg-violet-500/15 text-violet-200 border-violet-700/50 text-[10px] uppercase font-mono">{s.source_language}</Badge>
          )}
          {isDupe && <Badge variant="outline" className="bg-zinc-500/15 text-zinc-300 border-zinc-700/50 text-[10px]">DUPE</Badge>}
          <Badge variant="outline" className={badge.className + " text-[10px]"}>{badge.label}</Badge>
          {s.source_trust_tier && (
            <Badge variant="outline" className={tierColor(s.source_trust_tier) + " text-[10px]"}>
              {s.source_trust_tier.replace("_", " ")}
            </Badge>
          )}
          {typeof s.confidence_score === "number" && (
            <Badge variant="outline" className={confColor + " text-[10px] font-mono"}>
              {conf}% conf
            </Badge>
          )}
        </div>
      </div>
      {s.summary && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{s.summary}</p>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2 flex-wrap">
          {s.category && <span className="text-foreground/70">{s.category}</span>}
          {s.canonical_source_name && <span>· {s.canonical_source_name}</span>}
          {(s.corroboration_count ?? 0) > 1 && <span>· {s.corroboration_count} sources</span>}
          {(s.affected_countries?.length ?? 0) > 0 && (
            <span>· {s.affected_countries!.slice(0, 4).join(", ")}{s.affected_countries!.length > 4 ? "…" : ""}</span>
          )}
          {s.country_extraction_method && (s.affected_countries?.length ?? 0) > 0 && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-300 border-amber-700/50" title={`country inferred (conf ${s.country_extraction_confidence ?? 0})`}>inferred</Badge>
          )}
          {s.script_detected && s.script_detected !== "Latn" && (
            <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-300 border-violet-700/50">{s.script_detected}</Badge>
          )}
          {s.language_tier === "tier_3" && (
            <Badge variant="outline" className="text-[10px] bg-zinc-500/10 text-zinc-300 border-zinc-700/50">low-resource</Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {typeof s.impact_score === "number" && <span className="font-mono">imp {s.impact_score}</span>}
          {typeof s.detection_latency_seconds === "number" && (
            <span className="font-mono text-[10px] text-emerald-300/80" title="wire-to-ingest latency">
              {s.detection_latency_seconds < 60 ? `${s.detection_latency_seconds}s` : `${Math.round(s.detection_latency_seconds/60)}m`} latency
            </span>
          )}
          <span>{formatDistanceToNow(new Date(s.first_detected_at), { addSuffix: true })}</span>
          <button onClick={onToggleExpand} className="text-primary hover:underline">
            {expanded ? "hide" : "why?"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="space-y-2">
          <WhyRelevantPanel signal={s} />
          {s.confidence_explanation && <WhyTrustPanel signal={s} />}
          <TrustEvidence citations={citations} loading={citationsQ.isLoading} />
          <FeedbackRow
            signal={s}
            disabled={feedbackDisabled}
            onFeedback={(type) => onFeedback(type, {
              relevance_tier: s.relevance_tier,
              relevance_score: s.relevance_score,
              visibility,
              fallback: s.relevance_is_fallback,
            })}
          />
        </div>
      )}
    </div>
  );
}
