import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const normalize = (value?: number) => {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
};

export const ConfidenceBadge = ({
  value,
  className,
}: {
  value?: number;
  className?: string;
}) => {
  const normalized = normalize(value);

  if (normalized == null) {
    return (
      <Badge variant="outline" className={cn("font-mono text-[10px] text-muted-foreground", className)}>
        CONFIDENCE UNKNOWN
      </Badge>
    );
  }

  const label = normalized >= 75 ? "HIGH" : normalized >= 50 ? "MEDIUM" : "LOW";
  const tone =
    normalized >= 75
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
      : normalized >= 50
        ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
        : "border-destructive/30 bg-destructive/5 text-destructive";

  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", tone, className)}>
      {label} · {Math.round(normalized)}%
    </Badge>
  );
};
