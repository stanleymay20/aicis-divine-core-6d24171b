import { Database } from "lucide-react";
import { cn } from "@/lib/utils";

export const EvidenceCoverage = ({
  value,
  sourceCount,
  className,
}: {
  value?: number;
  sourceCount?: number;
  className?: string;
}) => {
  const normalized =
    value == null || Number.isNaN(value) ? null : Math.max(0, Math.min(100, value));

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-muted-foreground">
        <span>Evidence coverage</span>
        <span>{normalized == null ? "UNKNOWN" : Math.round(normalized) + "%"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {normalized != null && (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: normalized + "%" }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Database className="h-3 w-3" />
        {sourceCount == null ? "Source count unavailable" : sourceCount + " source" + (sourceCount === 1 ? "" : "s")}
      </div>
    </div>
  );
};
