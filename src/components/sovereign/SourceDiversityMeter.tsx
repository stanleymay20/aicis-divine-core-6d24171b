import { CitationChip, Citation } from "./CitationChip";
import { cn } from "@/lib/utils";

/**
 * Source diversity meter. Counts unique publishers and unique authority tiers
 * to give procurement reviewers an instant trust signal.
 */
export const SourceDiversityMeter = ({ citations }: { citations: Citation[] }) => {
  const uniqueNames = new Set(citations.map((c) => c.source_name.toLowerCase()));
  const tiers = new Set(citations.map((c) => c.authority_tier ?? 4));
  const score: "HIGH" | "MEDIUM" | "LOW" =
    uniqueNames.size >= 4 && tiers.size >= 2 ? "HIGH"
    : uniqueNames.size >= 2 ? "MEDIUM"
    : "LOW";
  const tone =
    score === "HIGH" ? "text-emerald-600 dark:text-emerald-400"
    : score === "MEDIUM" ? "text-amber-600 dark:text-amber-400"
    : "text-rose-600 dark:text-rose-400";

  return (
    <div className="rounded border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</span>
        <span className={cn("text-xs font-mono font-semibold", tone)}>
          Diversity: {score} · {uniqueNames.size} publishers
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {citations.map((c, i) => <CitationChip key={i} citation={c} size="xs" />)}
      </div>
    </div>
  );
};
