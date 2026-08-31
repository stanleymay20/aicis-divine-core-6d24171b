import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  ArrowLeft,
  BrainCircuit,
  LogOut,
  Menu,
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
  "/world": "World",
  "/command-center": "Legacy Command Center",
  "/morning-brief": "Brief",
  "/analyst": "Analysis",
  "/analyst-dashboard": "Analysis",
  "/forecast-validation": "Forecasts",
  "/predictions": "Forecasts",
  "/simulation": "Forecasts",
  "/decision-ops": "Decisions",
  "/decisions": "Decisions",
  "/watchlist": "Decisions",
  "/governance": "Data & Trust",
  "/evidence-command": "Data & Trust",
  "/data-pipeline": "Data & Trust",
  "/system-pulse": "System",
  "/admin": "System",
};

const titleFor = (pathname: string): string => {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/deepdive/") || pathname.startsWith("/local-events/") || pathname.startsWith("/atlas/")) return "World";
  if (pathname.startsWith("/learning") || pathname.startsWith("/training") || pathname.startsWith("/forecast")) return "Forecasts";
  if (pathname.startsWith("/governance") || pathname.startsWith("/operational-truth") || pathname.startsWith("/signal-validation")) return "Data & Trust";
  if (pathname.startsWith("/system") || pathname.startsWith("/infra") || pathname.startsWith("/api-audit")) return "System";
  return "AICIS";
};

const backTargetFor = (pathname: string): string | null => {
  if (pathname === "/world") return null;
  if (pathname.startsWith("/deepdive/") || pathname.startsWith("/local-events/") || pathname.startsWith("/atlas/")) return "/world";
  return "/world";
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

  const environment = import.meta.env.MODE === "production" ? "LIVE" : "PREVIEW";
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
    <header className="z-50 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/94 px-3 backdrop-blur-xl md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 md:hidden"
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
            aria-label="Back to World workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}

        <button
          type="button"
          onClick={() => navigate("/world")}
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open AICIS World workspace"
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.7)]" />
          </span>
          <span className="hidden text-xs font-semibold tracking-[0.12em] sm:block">AICIS</span>
        </button>

        <span className="hidden h-4 w-px bg-border md:block" aria-hidden="true" />
        <span className="truncate text-xs font-medium text-muted-foreground md:text-sm">{pageTitle}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <Badge
          variant="outline"
          className={`hidden h-6 gap-1.5 px-2 text-[10px] font-mono tracking-wide sm:inline-flex ${sensingTone}`}
          title={lastSignalAt ? `Latest signal detected ${lastSignalAt.toISOString()}` : "No current signal timestamp available"}
        >
          <Activity className="h-3 w-3" />
          {lastSignalAt ? formatDistanceToNow(lastSignalAt, { addSuffix: false }) : "NO FRESHNESS"}
        </Badge>

        {isAdmin && (
          <Badge
            variant="outline"
            className={environment === "LIVE"
              ? "hidden h-6 px-2 text-[10px] font-mono border-primary/30 bg-primary/5 text-primary lg:inline-flex"
              : "hidden h-6 px-2 text-[10px] font-mono border-amber-500/30 bg-amber-500/5 text-amber-400 lg:inline-flex"}
            title={`Runtime environment: ${environment}`}
          >
            {environment}
          </Badge>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 text-xs sm:flex"
          onClick={() => navigate("/intelligence-engine")}
        >
          <BrainCircuit className="h-3.5 w-3.5" /> Ask
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Account and operations menu">
              <User className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium">{user?.email?.split("@")[0] || "Operator"}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email || ""}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/world")}>
              <Activity className="mr-2 h-4 w-4" /> World workspace
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/intelligence-engine")}>
              <BrainCircuit className="mr-2 h-4 w-4" /> Ask AICIS
            </DropdownMenuItem>
            {isOperator && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Operations</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate("/data-pipeline")}>
                  <Server className="mr-2 h-4 w-4" /> Data & Trust
                </DropdownMenuItem>
              </>
            )}
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Administration</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <Shield className="mr-2 h-4 w-4" /> System
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
