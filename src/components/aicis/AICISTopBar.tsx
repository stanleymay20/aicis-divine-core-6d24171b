import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  ArrowLeft,
  BrainCircuit,
  LayoutGrid,
  LogOut,
  Menu,
  Search,
  Server,
  Shield,
  User,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRoles } from "@/hooks/useUserRoles";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/command-center": "Nervous System",
  "/morning-brief": "Executive Brief",
  "/live": "Live Signals",
  "/live-signals": "Live Signals",
  "/live-stream": "Nerve Traffic",
  "/risk-atlas": "Planetary Field",
  "/decisions": "Decision Ledger",
  "/decision-ops": "Decision Operations",
  "/watchlist": "Watchlist",
  "/intelligence-engine": "Ask AICIS",
  "/analyst": "Analyst Workspace",
  "/advanced": "Operator Console",
  "/admin": "System Administration",
  "/data-pipeline": "Data Backbone",
  "/developers": "Developer Platform",
  "/data-export": "Data Export",
  "/admin/export-center": "Data Export",
  "/export-center": "Data Export",
  "/system-pulse": "System Pulse",
  "/forecast-validation": "Forecast Validation",
};

const titleFor = (pathname: string): string => {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/deepdive/")) return "Country Deep Dive";
  if (pathname.startsWith("/local-events/")) return "Local Signals";
  if (pathname.startsWith("/atlas/region/")) return "Regional Field";
  if (pathname.startsWith("/system") || pathname.startsWith("/infra") || pathname.startsWith("/api-audit")) return "System Console";
  if (pathname.startsWith("/learning") || pathname.startsWith("/training") || pathname.startsWith("/forecast")) return "Learning Loop";
  if (pathname.startsWith("/governance") || pathname.startsWith("/operational-truth") || pathname.startsWith("/signal-validation")) return "Trust & Governance";
  return "Planetary Workspace";
};

const backTargetFor = (pathname: string): string | null => {
  if (pathname === "/command-center") return null;
  if (pathname.startsWith("/deepdive/") || pathname.startsWith("/local-events/") || pathname.startsWith("/atlas/region/")) return "/risk-atlas";
  if (pathname.startsWith("/admin") || pathname.startsWith("/data-pipeline") || pathname.startsWith("/infra")) return "/command-center";
  return "/command-center";
};

export const AICISTopBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { isAdmin, isOperator } = useUserRoles();
  const isMobile = useIsMobile();

  const pageTitle = titleFor(location.pathname);
  const backTarget = backTargetFor(location.pathname);

  const { data: lastSignalAt, isError: freshnessUnavailable } = useQuery({
    queryKey: ["topbar-data-freshness"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_signals")
        .select("first_detected_at")
        .order("first_detected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.first_detected_at ? new Date(data.first_detected_at) : null;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const environment = (import.meta as any).env?.MODE === "production" ? "LIVE" : "PREVIEW";
  const freshnessAgeMin = lastSignalAt
    ? Math.max(0, (Date.now() - lastSignalAt.getTime()) / 60_000)
    : null;
  const sensingState = freshnessUnavailable
    ? "unavailable"
    : freshnessAgeMin == null
      ? "waiting"
      : freshnessAgeMin < 30
        ? "fresh"
        : freshnessAgeMin < 180
          ? "aging"
          : "stale";

  const sensingTone =
    sensingState === "fresh"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
      : sensingState === "aging"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
        : sensingState === "stale" || sensingState === "unavailable"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border text-muted-foreground";

  return (
    <header className="h-12 shrink-0 border-b border-border/70 bg-background/90 px-3 md:px-4 backdrop-blur-xl flex items-center justify-between gap-3 z-50">
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden shrink-0"
            onClick={() => document.dispatchEvent(new CustomEvent("toggle-sidebar"))}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}

        {backTarget && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigate(backTarget)}
            aria-label="Back to planetary command center"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}

        <button
          type="button"
          onClick={() => navigate("/command-center")}
          className="group flex items-center gap-2.5 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open AICIS planetary nervous system"
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10">
            <span className="absolute inset-1 rounded-full border border-primary/25" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.8)]" />
          </span>
          <span className="hidden sm:block text-left min-w-0">
            <span className="block text-xs font-semibold tracking-[0.14em] leading-none">AICIS</span>
            <span className="block text-[9px] text-muted-foreground mt-1 tracking-wide">PLANETARY NERVOUS SYSTEM</span>
          </span>
        </button>

        <span className="hidden md:block h-5 w-px bg-border" aria-hidden="true" />
        <span className="truncate text-xs md:text-sm text-muted-foreground">{pageTitle}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <div className="hidden lg:flex items-center gap-2">
          <Badge
            variant="outline"
            className={`h-6 gap-1.5 px-2 text-[10px] font-mono tracking-wide ${sensingTone}`}
            title={lastSignalAt ? `Latest signal detected ${lastSignalAt.toISOString()}` : "No current signal timestamp available"}
          >
            <Activity className="h-3 w-3" />
            SENSING
            <span className="opacity-80">
              {lastSignalAt ? formatDistanceToNow(lastSignalAt, { addSuffix: false }) : "—"}
            </span>
          </Badge>

          {isAdmin && (
            <Badge
              variant="outline"
              className={environment === "LIVE"
                ? "h-6 px-2 text-[10px] font-mono border-primary/30 bg-primary/5 text-primary"
                : "h-6 px-2 text-[10px] font-mono border-amber-500/30 bg-amber-500/5 text-amber-400"}
              title={`Runtime environment: ${environment}`}
            >
              {environment}
            </Badge>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="hidden sm:flex h-8 gap-1.5 text-xs"
          onClick={() => navigate("/intelligence-engine")}
        >
          <BrainCircuit className="h-3.5 w-3.5" />
          Ask
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Account and operations menu">
              <User className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium truncate">{user?.email?.split("@")[0] || "Operator"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Intelligence</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => navigate("/intelligence-engine")}>
              <Search className="h-4 w-4 mr-2" /> Ask AICIS
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/command-center")}>
              <BrainCircuit className="h-4 w-4 mr-2" /> Nervous System
            </DropdownMenuItem>
            {isOperator && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Operations</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate("/advanced")}>
                  <LayoutGrid className="h-4 w-4 mr-2" /> Operator Console
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/data-pipeline")}>
                  <Server className="h-4 w-4 mr-2" /> Data Backbone
                </DropdownMenuItem>
              </>
            )}
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Administration</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <Shield className="h-4 w-4 mr-2" /> System Administration
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
