import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { User, LogOut, Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/morning-brief": "Today's Brief",
  "/live": "Supply Chain Risks",
  "/live-signals": "Supply Chain Risks",
  "/risk-atlas": "Risk Atlas",
  "/decisions": "Actions & Outcomes",
  "/decision-ops": "Actions & Outcomes",
  "/daily-evidence-ops": "Daily Ops",
  "/evidence-command": "Proven Results",
  "/operational-truth": "Data Quality",
  "/governance": "Governance",
  "/admin": "Settings",
  "/signal-validation": "Signal Validation",
  "/resolution": "Country & Region Risk Map",
  "/watchlist": "Tracked Markets",
  "/learning": "System Accuracy",
};

export const AICISTopBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const isMobile = useIsMobile();

  const pageTitle = PAGE_TITLES[location.pathname] || "";

  return (
    <header className="h-12 bg-card border-b border-border flex items-center justify-between px-4 z-50 shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3 min-w-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden shrink-0"
            onClick={() => {
              document.dispatchEvent(new CustomEvent("toggle-sidebar"));
            }}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center gap-2.5 cursor-pointer shrink-0" onClick={() => navigate("/")}>
          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <span className="text-primary font-bold text-xs">AI</span>
          </div>
          <span className="text-sm font-semibold tracking-tight hidden sm:inline">AICIS</span>
        </div>
        {pageTitle && (
          <>
            <span className="text-border hidden sm:inline">/</span>
            <span className="text-sm text-muted-foreground truncate">{pageTitle}</span>
          </>
        )}
      </div>

      {/* Right */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <User className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">{user?.email?.split("@")[0] || "Operator"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
          </div>
          <DropdownMenuItem onClick={signOut} className="text-destructive">
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};
