import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  DatabaseZap,
  Globe2,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  X,
} from "lucide-react";
import { useUserRoles } from "@/hooks/useUserRoles";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeSection: string;
  onSectionChange: (section: string) => void;
}

type OperationalRole = "analyst" | "operator" | "admin";

type NavItem = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  match?: string[];
  minRole?: OperationalRole;
};

const primaryItems: NavItem[] = [
  {
    id: "world",
    label: "World",
    description: "Global map and live situation",
    icon: Globe2,
    path: "/world",
    match: ["/world", "/command-center", "/risk-atlas", "/atlas", "/live", "/live-signals", "/live-stream", "/local-events", "/spatial-cockpit", "/cockpit"],
  },
  {
    id: "brief",
    label: "Brief",
    description: "Executive intelligence synthesis",
    icon: LayoutDashboard,
    path: "/morning-brief",
    match: ["/morning-brief", "/brief"],
  },
  {
    id: "analysis",
    label: "Analysis",
    description: "Research, causality and deep dives",
    icon: BarChart3,
    path: "/analyst",
    match: ["/analyst", "/analyst-dashboard", "/intelligence-engine", "/planetary-intelligence", "/planetary-graph", "/resolution", "/deepdive", "/risk-ranking"],
  },
  {
    id: "forecasts",
    label: "Forecasts",
    description: "Predictions, scenarios and outcomes",
    icon: Target,
    path: "/forecast-validation",
    match: ["/forecast-validation", "/predictions", "/simulation", "/learning", "/learning-loop", "/outcome-cockpit"],
  },
  {
    id: "decisions",
    label: "Decisions",
    description: "Governed decisions and watchlists",
    icon: Workflow,
    path: "/decision-ops",
    match: ["/decision-ops", "/decisions", "/watchlist"],
  },
  {
    id: "data-trust",
    label: "Data & Trust",
    description: "Evidence, provenance and integrity",
    icon: ShieldCheck,
    path: "/governance",
    match: ["/governance", "/evidence-command", "/daily-evidence-ops", "/signal-validation", "/operational-truth", "/coverage-equity", "/pilot-truth", "/data-integrity", "/training-dataset", "/accumulation"],
  },
  {
    id: "system",
    label: "System",
    description: "Operations, health and administration",
    icon: DatabaseZap,
    path: "/system-pulse",
    match: ["/system-pulse", "/system-status", "/system-catalog", "/infra-ops", "/data-pipeline", "/api-audit", "/advanced", "/more", "/developers", "/admin", "/export-center", "/data-export", "/export-layer", "/exports", "/quantivis-exports", "/federation-admin", "/register-node"],
    minRole: "operator",
  },
];

export const SIDEBAR_WIDTH_EXPANDED = 232;
export const SIDEBAR_WIDTH_COLLAPSED = 56;

const roleRank: Record<OperationalRole, number> = {
  analyst: 1,
  operator: 2,
  admin: 3,
};

export const AICISSidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isOperator, isAnalyst } = useUserRoles();

  const currentRole: OperationalRole | null = isAdmin
    ? "admin"
    : isOperator
      ? "operator"
      : isAnalyst
        ? "analyst"
        : null;

  const canSee = (item: NavItem) => {
    if (!item.minRole) return true;
    if (!currentRole) return false;
    return roleRank[currentRole] >= roleRank[item.minRole];
  };

  const visibleItems = primaryItems.filter(canSee);

  const isActive = (item: NavItem) => {
    const paths = item.match ?? [item.path];
    return paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  };

  const handleNavClick = (item: NavItem, closeMobile = false) => {
    navigate(item.path);
    if (closeMobile) onToggle();
  };

  const NavButton = ({ item, compact }: { item: NavItem; compact: boolean }) => {
    const Icon = item.icon;
    const active = isActive(item);

    const button = (
      <button
        type="button"
        onClick={() => handleNavClick(item)}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex w-full items-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-10 justify-center px-0" : "min-h-11 gap-3 px-3 py-2 text-left",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        )}
      >
        {active && !compact && (
          <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" />
        )}
        <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-primary")} />
        {!compact && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium leading-none">{item.label}</span>
            <span className="mt-1 block truncate text-[10px] leading-tight text-muted-foreground">{item.description}</span>
          </span>
        )}
      </button>
    );

    if (!compact) return button;

    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-56">
          <div className="text-xs font-medium">{item.label}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{item.description}</div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const DesktopSidebar = (
    <aside
      role="navigation"
      aria-label="AICIS primary intelligence navigation"
      style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      className={cn(
        "fixed left-0 top-12 bottom-0 z-40 hidden md:flex flex-col",
        "border-r border-border/70 bg-background/94 backdrop-blur-xl",
        "transition-[width] duration-200 ease-out",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-border/60 px-3", collapsed ? "justify-center" : "gap-3")}>
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/5">
          <div className="absolute inset-1 rounded-full border border-primary/15" />
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-[0.1em]">AICIS</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">Planetary intelligence workspace</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 scrollbar-hide">
        {!collapsed && (
          <div className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
            Primary workspace
          </div>
        )}
        <div className="flex flex-col gap-1">
          {visibleItems.map((item) => (
            <NavButton key={item.id} item={item} compact={collapsed} />
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-border/60">
        {!collapsed && (
          <div className="px-3 pt-2 pb-1">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/80" aria-hidden="true" />
              <span>{currentRole ? `${currentRole.toUpperCase()} WORKSPACE` : "READ-ONLY WORKSPACE"}</span>
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/70">
              Legacy routes remain available as contextual deep links.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "flex h-10 w-full items-center text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            collapsed ? "justify-center" : "gap-2 px-3",
          )}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );

  const MobileDrawer = !collapsed && (
    <div className="fixed inset-0 z-50 md:hidden" onClick={onToggle}>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      <aside
        className="absolute left-0 top-0 bottom-0 w-[292px] border-r border-border bg-background flex flex-col"
        onClick={(event) => event.stopPropagation()}
        aria-label="AICIS mobile primary navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/5">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-xs font-semibold tracking-[0.1em]">AICIS</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">Planetary intelligence</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <div className="px-3 pb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
            Primary workspace
          </div>
          <div className="flex flex-col gap-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item, true)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/40",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </aside>
    </div>
  );

  return (
    <TooltipProvider>
      {DesktopSidebar}
      {MobileDrawer}
    </TooltipProvider>
  );
};