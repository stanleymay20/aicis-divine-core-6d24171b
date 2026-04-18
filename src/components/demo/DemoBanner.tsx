import { Button } from "@/components/ui/button";
import { Eye, X, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useDemoMode } from "@/contexts/DemoModeContext";

export const DemoBanner = () => {
  const { isDemo, disableDemo } = useDemoMode();

  if (!isDemo) return null;

  return (
    <div className="sticky top-0 z-[100] bg-gradient-to-r from-primary/15 via-primary/10 to-secondary/15 border-b border-primary/30 backdrop-blur-md">
      <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 text-primary font-semibold shrink-0">
            <Eye className="h-3.5 w-3.5" />
            DEMO MODE
          </span>
          <span className="text-muted-foreground truncate hidden sm:inline">
            Read-only sandbox · Pre-seeded scenarios · No data is written
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="default" asChild className="h-7 text-xs">
            <Link to="/auth">
              Get Full Access <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={disableDemo}
            title="Exit demo"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
