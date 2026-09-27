import { formatDistanceToNowStrict } from "date-fns";
import { Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const FreshnessBadge = ({
  timestamp,
  className,
}: {
  timestamp?: string;
  className?: string;
}) => {
  if (!timestamp) {
    return (
      <Badge variant="outline" className={cn("gap-1 font-mono text-[10px] text-muted-foreground", className)}>
        <Clock3 className="h-3 w-3" />
        FRESHNESS UNKNOWN
      </Badge>
    );
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return (
      <Badge variant="outline" className={cn("gap-1 font-mono text-[10px] text-muted-foreground", className)}>
        <Clock3 className="h-3 w-3" />
        FRESHNESS UNKNOWN
      </Badge>
    );
  }

  const ageMinutes = Math.max(0, (Date.now() - date.getTime()) / 60_000);
  const tone =
    ageMinutes < 30
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
      : ageMinutes < 180
        ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
        : "border-destructive/30 bg-destructive/5 text-destructive";

  return (
    <Badge variant="outline" className={cn("gap-1 font-mono text-[10px]", tone, className)}>
      <Clock3 className="h-3 w-3" />
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </Badge>
  );
};
