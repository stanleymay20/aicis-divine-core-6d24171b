import { Inbox, type LucideIcon } from "lucide-react";

interface PanelEmptyProps {
  /** What the panel normally shows */
  title: string;
  /** Why it may be empty */
  reason: string;
  /** What the operator should do next */
  nextStep: string;
  icon?: LucideIcon;
  compact?: boolean;
}

/**
 * Standard operator-facing empty-state guidance.
 * Always answers: what / why / next.
 */
export function PanelEmpty({ title, reason, nextStep, icon: Icon = Inbox, compact }: PanelEmptyProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 ${
        compact ? "p-4 min-h-[100px]" : "p-6 min-h-[140px]"
      }`}
    >
      <Icon className="h-5 w-5 text-muted-foreground/70" />
      <div className="text-xs font-medium text-foreground">{title}</div>
      <div className="text-[11px] text-muted-foreground max-w-md leading-relaxed">
        <span className="block">{reason}</span>
        <span className="block mt-1 text-foreground/80">Next: {nextStep}</span>
      </div>
    </div>
  );
}
