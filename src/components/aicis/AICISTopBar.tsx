import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, LogOut, Menu, ArrowLeft, Download, Code2, LayoutGrid, Settings as SettingsIcon, Home, ShieldCheck, Activity } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/morning-brief": "Today's Brief",
  "/live": "Supply Chain Risks",
  "/live-signals": "Supply Chain Risks",
  "/live-stream": "Live Signal Stream",
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
  "/learning-loop": "Learning Loop",
  "/risk-ranking": "Risk Ranking",
  "/intelligence-engine": "Intelligence Engine",
  "/simulation": "Simulation",
  "/predictions": "Predictions",
  "/api-audit": "API Audit",
  "/forecast-validation": "Forecast Validation",
  "/training-dataset": "Training Dataset",
  "/system-pulse": "System Pulse",
  "/system-status": "System Status",
  "/system-catalog": "System Catalog",
  "/data-pipeline": "Data Pipeline",
  "/infra-ops": "Infrastructure",
  "/pilot-truth": "Pilot Truth Feed",
  "/outcome-cockpit": "Outcome Cockpit",
  "/accumulation": "Accumulation",
  "/coverage-equity": "Coverage Equity",
  "/developers": "Developer Portal",
  "/register-node": "Register Node",
  "/local-events": "Local Events",
  "/admin/export-center": "Data Export",
  "/export-center": "Data Export",
  "/data-export": "Data Export",
  "/advanced": "Advanced",
};

const ROUTE_HOME: Record<string, string> = {
  "/morning-brief": "",
  "/live": "/morning-brief",
  "/live-signals": "/morning-brief",
  "/decision-ops": "/morning-brief",
  "/risk-atlas": "/morning-brief",
  "/admin": "/morning-brief",
  "/advanced": "/morning-brief",
  "/data-export": "/advanced",
  "/export-center": "/advanced",
  "/admin/export-center": "/advanced",
  "/developers": "/advanced",
};

// Routes that should NOT show a back button (primary nav destinations).
const PRIMARY_ROUTES = new Set([
  "/morning-brief",
  "/live",
  "/decision-ops",
  "/risk-atlas",
  "/admin",
]);

const titleFor = (pathname: string): string => {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // dynamic routes
  if (pathname.startsWith("/deepdive/")) return "Country Deep Dive";
  if (pathname.startsWith("/local-events/")) return "Local Events";
  if (pathname.startsWith("/atlas/region/")) return "Region Drill-Down";
  return "";
};

const homeFor = (pathname: string) => {
  if (ROUTE_HOME[pathname] !== undefined) return ROUTE_HOME[pathname];
  if (pathname.startsWith("/deepdive/") || pathname.startsWith("/local-events/") || pathname.startsWith("/atlas/region/")) return "/risk-atlas";
  return "/advanced";
};

export const AICISTopBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const isMobile = useIsMobile();

  const pageTitle = titleFor(location.pathname);
  const backTarget = homeFor(location.pathname);
  const showBack = Boolean(backTarget) && !PRIMARY_ROUTES.has(location.pathname) && location.pathname !== "/";

  // Data freshness — most recent enriched signal heartbeat
  const { data: lastSignalAt } = useQuery({
    queryKey: ["topbar-data-freshness"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_signals")
        .select("first_detected_at")
        .order("first_detected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.first_detected_at ? new Date(data.first_detected_at) : null;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const env = (import.meta as any).env?.MODE === "production" ? "LIVE" : "PREVIEW";
  const freshnessAgeMin = lastSignalAt
    ? (Date.now() - lastSignalAt.getTime()) / 60_000
    : null;
  const freshnessTone =
    freshnessAgeMin == null
      ? "text-muted-foreground"
      : freshnessAgeMin < 30
      ? "text-emerald-500"
      : freshnessAgeMin < 180
      ? "text-amber-500"
      : "text-destructive";

  const handleBack = () => {
    navigate(backTarget || "/morning-brief");
  };

  return (
    <header className="h-12 bg-card border-b border-border flex items-center justify-between px-4 z-50 shrink-0">
      {/* Left */}
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden shrink-0"
            onClick={() => {
              document.dispatchEvent(new CustomEvent("toggle-sidebar"));
            }}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        {showBack && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 shrink-0 gap-1"
            onClick={handleBack}
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Back</span>
          </Button>
        )}
        {!showBack && location.pathname !== "/morning-brief" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigate("/morning-brief")}
            aria-label="Go to today's brief"
          >
            <Home className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center gap-2.5 cursor-pointer shrink-0" onClick={() => navigate("/morning-brief")}>
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

      {/* Center: trust + freshness badges */}
      <div className="hidden md:flex items-center gap-2 mx-3">
        <Badge
          variant="outline"
          className="h-6 px-1.5 gap-1 text-[10px] font-mono tracking-wide border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
          title="Aggregate, public-source data only. No PII processed."
        >
          <ShieldCheck className="h-3 w-3" />
          NON-SURVEILLANCE
        </Badge>
        <Badge
          variant="outline"
          className={`h-6 px-1.5 gap-1 text-[10px] font-mono tracking-wide border-border ${freshnessTone}`}
          title={lastSignalAt ? `Last signal ingested ${lastSignalAt.toISOString()}` : "Awaiting signals"}
        >
          <Activity className="h-3 w-3" />
          {lastSignalAt ? `${formatDistanceToNow(lastSignalAt)} ago` : "—"}
        </Badge>
        <Badge
          variant="outline"
          className={`h-6 px-1.5 text-[10px] font-mono tracking-wide ${
            env === "LIVE"
              ? "border-primary/40 text-primary bg-primary/5"
              : "border-amber-500/40 text-amber-500 bg-amber-500/5"
          }`}
          title={`Environment: ${env}`}
        >
          {env}
        </Badge>
      </div>

      {/* Right */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Account menu">
            <User className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">{user?.email?.split("@")[0] || "Operator"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/data-export")}>
            <Download className="h-4 w-4 mr-2" /> Data Export
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/developers")}>
            <Code2 className="h-4 w-4 mr-2" /> Developer & API
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/advanced")}>
            <LayoutGrid className="h-4 w-4 mr-2" /> Advanced
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/admin")}>
            <SettingsIcon className="h-4 w-4 mr-2" /> Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive">
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};
