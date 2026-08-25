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
  Activity,
  BarChart3,
  BrainCircuit,
  ChevronsLeft,
  ChevronsRight,
  DatabaseZap,
  FileSearch,
  FlaskConical,
  Gauge,
  GitBranch,
  Globe2,
  HeartPulse,
  LayoutDashboard,
  Network,
  Radio,
  ScanSearch,
  ScrollText,
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
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  match?: string[];
  minRole?: OperationalRole;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    id: "sense",
    label: "Sense",
    items: [
      { id: "nervous-system", label: "Nervous System", icon: Sparkles, path: "/command-center" },
      { id: "live-signals", label: "Live Signals", icon: Radio, path: "/live", match: ["/live", "/live-signals", "/live-stream"] },
      { id: "planetary-field", label: "Planetary Field", icon: Globe2, path: "/risk-atlas", match: ["/risk-atlas", "/atlas"] },
      { id: "local-signals", label: "Local Signals", icon: ScanSearch, path: "/local-events" },
      { id: "brief", label: "Executive Brief", icon: LayoutDashboard, path: "/morning-brief" },
    ],
  },
  {
    id: "understand",
    label: "Understand",
    items: [
      { id: "analyst", label: "Analyst Workspace", icon: BarChart3, path: "/analyst", match: ["/analyst", "/analyst-dashboard"] },
      { id: "causal", label: "Causal Intelligence", icon: Network, path: "/intelligence-engine" },
      { id: "planetary-graph", label: "Planetary Graph", icon: GitBranch, path: "/planetary-graph" },
      { id: "risk-ranking", label: "Threat Matrix", icon: Target, path: "/risk-ranking" },
      { id: "country-explorer", label: "Country Explorer", icon: FileSearch, path: "/resolution", match: ["/resolution", "/deepdive"] },
    ],
  },
  {
    id: "decide-act",
    label: "Decide & Act",
    items: [
      { id: "decision-ops", label: "Decision Operations", icon: Workflow, path: "/decision-ops", match: ["/decision-ops", "/decisions"] },
      { id: "simulation", label: "Scenario Studio", icon: FlaskConical, path: "/simulation" },
      { id: "predictions", label: "Intervention Outlook", icon: Activity, path: "/predictions" },
      { id: "watchlist", label: "Watchlist", icon: Gauge, path: "/watchlist" },
    ],
  },
  {
    id: "learn",
    label: "Learn",
    items: [
      { id: "forecast-validation", label: "Forecast Validation", icon: BrainCircuit, path: "/forecast-validation" },
      { id: "learning-loop", label: "Learning Loop", icon: HeartPulse, path: "/learning-loop" },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { id: "data-backbone", label: "Data Backbone", icon: DatabaseZap, path: "/data-pipeline", minRole: "operator" },
      { id: "system-pulse", label: "System Pulse", icon: Activity, path: "/system-pulse", minRole: "operator" },
      { id: "governance", label: "Trust & Governance", icon: ShieldCheck, path: "/governance" },
      { id: "audit", label: "Audit Trail", icon: ScrollText, path: "/api-audit", minRole: "operator" },
      { id: "admin", label: "System Administration", icon: ShieldCheck, path: "/admin", minRole: "admin" },
    ],
  },
];

export const SIDEBAR_WIDTH_EXPANDED = 252;
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

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter(canSee) }))
    .filter((group) => group.items.length > 0);

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
          "group relative flex h-9 w-full items-center rounded-md text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "justify-center px-0" : "gap-2.5 px-2.5",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        )}
      >
        {active && !compact && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
        )}
        <Icon className={cn("h-[17px] w-[17px] shrink-0", active && "text-primary")} />
        {!compact && <span className="truncate text-left">{item.label}</span>}
      </button>
    );

    if (!compact) return button;

    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs font-medium">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const DesktopSidebar = (
    <aside
      role="navigation"
      aria-label="AICIS nervous system navigation"
      style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      className={cn(
        "fixed left-0 top-12 bottom-0 z-40 hidden md:flex flex-col",
        "border-r border-border/70 bg-background/92 backdrop-blur-xl",
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
            <div className="text-xs font-semibold tracking-[0.1em]">PLANETARY CORE</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">Observe · reason · coordinate</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-hide">
        {visibleGroups.map((group, index) => (
          <div key={group.id} className={cn("px-2", index > 0 && "mt-3")}>
            {!collapsed && (
              <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
                {group.label}
              </div>
            )}
            {collapsed && index > 0 && <div className="mx-2 my-2 h-px bg-border/60" />}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavButton key={item.id} item={item} compact={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border/60">
        {!collapsed && (
          <div className="px-3 pt-2 pb-1">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/80" aria-hidden="true" />
              <span>{currentRole ? `${currentRole.toUpperCase()} WORKSPACE` : "READ-ONLY WORKSPACE"}</span>
            </div>
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
        aria-label="AICIS mobile navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/5">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-xs font-semibold tracking-[0.1em]">PLANETARY CORE</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">AICIS nervous system</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {visibleGroups.map((group) => (
            <div key={group.id} className="mb-3 px-2">
              <div className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item, true)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/40",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate text-left">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
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