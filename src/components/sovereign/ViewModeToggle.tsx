import { useViewMode } from "@/contexts/ExecutiveModeContext";
import { Eye, Microscope } from "lucide-react";
import { cn } from "@/lib/utils";

export const ViewModeToggle = ({ className }: { className?: string }) => {
  const { mode, setMode } = useViewMode();
  return (
    <div className={cn("inline-flex rounded border border-border bg-card p-0.5 text-[10px] font-mono", className)}>
      <button
        onClick={() => setMode("executive")}
        className={cn(
          "px-2 py-1 rounded inline-flex items-center gap-1 transition-colors",
          mode === "executive" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={mode === "executive"}
      >
        <Eye className="h-3 w-3" aria-hidden /> Executive
      </button>
      <button
        onClick={() => setMode("analyst")}
        className={cn(
          "px-2 py-1 rounded inline-flex items-center gap-1 transition-colors",
          mode === "analyst" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={mode === "analyst"}
      >
        <Microscope className="h-3 w-3" aria-hidden /> Analyst
      </button>
    </div>
  );
};
