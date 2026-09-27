import { Command, PanelRight } from "lucide-react";
import { useIntelligenceOS } from "@/contexts/IntelligenceOSContext";

export const SystemStatusBar = () => {
  const { selectedEntity, isInspectorOpen } = useIntelligenceOS();
  const environment = import.meta.env.MODE === "production" ? "LIVE" : "PREVIEW";

  return (
    <div
      className="flex min-h-7 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/70 bg-background/95 px-3 py-1 text-[9px] font-mono text-muted-foreground"
      aria-label="AICIS workspace status"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>RUNTIME · {environment}</span>
        <span>
          CONTEXT · {selectedEntity ? selectedEntity.type.toUpperCase() + ":" + selectedEntity.id : "NONE"}
        </span>
        <span className="inline-flex items-center gap-1">
          <PanelRight className="h-2.5 w-2.5" />
          INSPECTOR · {isInspectorOpen ? "OPEN" : "STANDBY"}
        </span>
      </div>
      <span className="inline-flex items-center gap-1">
        <Command className="h-2.5 w-2.5" />
        CTRL/⌘ K · SEARCH & COMMANDS
      </span>
    </div>
  );
};
