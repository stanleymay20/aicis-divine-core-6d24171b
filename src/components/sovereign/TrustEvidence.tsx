import { CitationChipList } from "@/components/sovereign/CitationChip";
import type { Citation } from "@/components/sovereign/CitationChip";
import { ShieldQuestion } from "lucide-react";

/**
 * Standard "Why should we trust this?" block — the fourth mandatory
 * question every intelligence artifact must answer (Trust Doctrine).
 *
 * Always render this on signal / warning / recommendation cards.
 * Empty state is intentional: no citations = explicit "opinion only" badge.
 */
export function TrustEvidence({
  citations,
  loading,
  max = 6,
  compact = false,
}: {
  citations: Citation[] | undefined;
  loading?: boolean;
  max?: number;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-1" : "mt-2 rounded border border-border/60 bg-muted/20 p-2"}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1">
        <ShieldQuestion className="h-3 w-3" />
        Why trust this?
      </div>
      {loading ? (
        <div className="text-[10px] font-mono text-muted-foreground">Loading evidence…</div>
      ) : (
        <CitationChipList citations={citations ?? []} max={max} />
      )}
    </div>
  );
}
