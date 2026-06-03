import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

export interface Citation {
  source_name: string;
  source_url?: string | null;
  confidence_weight?: number | null;
  authority_tier?: number | null;
}

/**
 * Visible citation chip. Procurement buyers trust what they can verify.
 * No citation = opinion. Citation = intelligence.
 */
export const CitationChip = ({ citation, size = "sm" }: { citation: Citation; size?: "xs" | "sm" }) => {
  const tier = citation.authority_tier ?? 3;
  const tone =
    tier === 1 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : tier === 2 ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400"
    : "border-muted-foreground/30 bg-muted text-muted-foreground";

  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-mono",
        tone,
        size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs",
      )}
      title={`Tier-${tier} · ${citation.source_name}${citation.confidence_weight ? ` · ${citation.confidence_weight.toFixed(2)}` : ""}`}
    >
      <span className="font-medium">{citation.source_name}</span>
      {citation.confidence_weight != null && (
        <span className="opacity-70">({citation.confidence_weight.toFixed(2)})</span>
      )}
      {citation.source_url && <ExternalLink className="h-2.5 w-2.5 opacity-60" aria-hidden />}
    </span>
  );

  return citation.source_url ? (
    <a href={citation.source_url} target="_blank" rel="noopener noreferrer" className="no-underline">{inner}</a>
  ) : inner;
};

export const CitationChipList = ({ citations, max = 6 }: { citations: Citation[]; max?: number }) => {
  if (!citations?.length) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-600 dark:text-amber-400">
        ⚠ No citations — opinion only
      </span>
    );
  }
  const shown = citations.slice(0, max);
  const extra = citations.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((c, i) => <CitationChip key={i} citation={c} />)}
      {extra > 0 && <span className="text-[10px] font-mono text-muted-foreground">+{extra} more</span>}
    </div>
  );
};
