import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, LogOut, Menu, ArrowLeft, Home, ShieldCheck, Activity, Search, Eye, LayoutGrid, Shield, Server } from "lucide-react";
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
  "/": "Home",
  "/morning-brief": "Brief",
  "/live": "Signals",
  "/live-signals": "Signals",
  "/risk-atlas": "Atlas",
  "/decisions": "Decisions",
  "/decision-ops": "Decisions",
  "/watchlist": "Watchlist",
  "/intelligence-engine": "Ask AICIS",
  "/advanced": "Operator Console",
  "/admin": "System Admin",
  "/data-pipeline": "Pipeline Health",
  "/developers": "Developer Platform",
  "/data-export": "Data Export",
  "/admin/export-center": "Data Export",
  "/export-center": "Data Export",
};

const PRIMARY_ROUTES = new Set([
  "/morning-brief",
  "/live",
  "/decision-ops",
  "/risk-atlas",
  "/intelligence-engine",
  "/watchlist",
]);

const titleFor = (pathname: string): string => {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/deepdive/")) return "Country Deep Dive";
  if (pathname.startsWith("/local-events/")) return "Local Events";
  if (pathname.startsWith("/atlas/region/")) return "Region Drill-Down";
  if (pathname.startsWith("/system") || pathname.startsWith("/infra") || pathname.startsWith("/api-audit")) return "System Console";
  if (pathname.startsWith("/learning") || pathname.startsWith("/training") || pathname.startsWith("/forecast")) return "Model Intelligence";
  if (pathname.startsWith("/governance") || pathname.startsWith("/operational-truth") || pathname.startsWith("/signal-validation")) return "Trust & Governance";
  return "AICIS";
};

const homeFor = (pathname: string) => {
  if (PRIMARY_ROUTES.has(pathname)) return "";
  if (pathname.startsWith("/deepdive/") || pathname.startsWith("/local-events/") || pathname.startsWith("/atlas/region/")) return "/risk-atlas";
  if (pathname.startsWith("/data-pipeline") || pathname.startsWith("/admin") || pathname.startsWith("/developers") || pathname.startsWith("/data-export")) return "/admin";
  if (pathname.startsWith("/advanced")) return "/morning-brief";
  return "/advanced";
};

export const AICISTopBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { isAdmin, isOperator } = useUserRoles();
  const isMobile = useIsMobile();

  const pageTitle = titleFor(location.pathname);
  const backTarget = homeFor(location.pathname);
  const showBack = Boolean(backTarget) && location.pathname !== "/";

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
  const freshnessAgeMin = lastSignalAt ? (Date.now() - lastSignalAt.getTime()) / 60_000 : null;
  const freshnessTone =
    freshnessAgeMin == null
      ? "text-muted-foreground"
      : freshnessAgeMin < 30
      ? "text-emerald-500"
      : freshnessAgeMin < 180
      ? "text-amber-500"
      : "text-destructive";

  return (
    <header className="h-12 bg-card border-b border-border flex items-center justify-between px-4 z-50 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden shrink-0"
            onClick={() => document.dispatchEvent(new CustomEvent("toggle-sidebar"))}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        {showBack ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 shrink-0 gap-1"
            onClick={() => navigate(backTarget || "/morning-brief")}
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Back</span>
          </Button>
        ) : location.pathname !== "/morning-brief" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigate("/morning-brief")}
            aria-label="Go to brief"
          >
            <Home className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="flex items-center gap-2.5 cursor-pointer shrink-0" onClick={() => navigate("/morning-brief")}>
          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <span className="text-primary font-bold text-xs">AI</span>
          </div>
          <span className="text-sm font-semibold tracking-tight hidden sm:inline">AICIS</span>
        </div>
        <span className="text-border hidden sm:inline">/</span>
        <span className="text-sm text-muted-foreground truncate">{pageTitle}</span>
      </div>

      <div className="hidden lg:flex items-center gap-2 mx-3">
        <Badge
          variant="outline"
          className="h-6 px-1.5 gap-1 text-[10px] font-mono tracking-wide border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
          title="Aggregate, public-source intelligence. No PII surveillance."
        >
          <ShieldCheck className="h-3 w-3" />
          TRUSTED SOURCES
        </Badge>
        <Badge
          variant="outline"
          className={`h-6 px-1.5 gap-1 text-[10px] font-mono tracking-wide border-border ${freshnessTone}`}
          title={lastSignalAt ? `Last signal ingested ${lastSignalAt.toISOString()}` : "Awaiting signals"}
        >
          <Activity className="h-3 w-3" />
          {lastSignalAt ? `${formatDistanceToNow(lastSignalAt)} ago` : "—"}
        </Badge>
        {isAdmin && (
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
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Account menu">
            <User className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">{user?.email?.split("@")[0] || "Operator"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Command</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => navigate("/intelligence-engine")}>
            <Search className="h-4 w-4 mr-2" /> Ask AICIS
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/watchlist")}>
            <Eye className="h-4 w-4 mr-2" /> Watchlist
          </DropdownMenuItem>
          {isOperator && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Operator</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate("/advanced")}>
                <LayoutGrid className="h-4 w-4 mr-2" /> Operator Console
              </DropdownMenuItem>
            </>
          )}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => navigate("/admin")}>
                <Shield className="h-4 w-4 mr-2" /> System Admin
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/data-pipeline")}>
                <Server className="h-4 w-4 mr-2" /> Pipeline Health
              </DropdownMenuItem>
            </>
          )}
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
