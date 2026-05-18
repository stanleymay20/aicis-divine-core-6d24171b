import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Database,
  FileSearch,
  FlaskConical,
  Gauge,
  Globe2,
  HeartPulse,
  LayoutDashboard,
  Lock,
  Network,
  Radio,
  Rss,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  X,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeSection: string;
  onSectionChange: (section: string) => void;
}

type NavItem = {
  id: string;
  label: string;
  icon: any;
  path: string;
  match?: string[];
  badge?: { count: number; tone: "danger" | "warning" | "info" };
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    id: "command",
    label: "Command",
    items: [
      { id: "executive", label: "Executive Summary", icon: LayoutDashboard, path: "/morning-brief" },
      { id: "global-map", label: "Global Map", icon: Globe2, path: "/risk-atlas", match: ["/risk-atlas", "/atlas"] },
      { id: "workflow", label: "Operational Workflow", icon: Workflow, path: "/decision-ops", match: ["/decision-ops", "/decisions"] },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    items: [
      { id: "analyst", label: "Analyst Dashboard", icon: BarChart3, path: "/analyst", match: ["/analyst", "/analyst-dashboard"] },
      { id: "threat-matrix", label: "Threat Matrix", icon: Target, path: "/risk-ranking" },
      { id: "risk-explorer", label: "Risk Explorer", icon: FileSearch, path: "/resolution", match: ["/resolution", "/deepdive"] },
      { id: "causal", label: "Causal Network", icon: Network, path: "/intelligence-engine" },
      { id: "scenario", label: "Scenario Builder", icon: FlaskConical, path: "/simulation" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "live-ops", label: "Live Operations", icon: Radio, path: "/live", match: ["/live", "/live-signals", "/live-stream"] },
      { id: "interventions", label: "Interventions", icon: Activity, path: "/predictions" },
      {
        id: "escalations",
        label: "Escalations",
        icon: AlertTriangle,
        path: "/pilot-truth",
        badge: { count: 7, tone: "danger" },
      },
      { id: "tasking", label: "Tasking & Requests", icon: ClipboardList, path: "/daily-evidence-ops" },
    ],
  },
  {
    id: "systems",
    label: "Systems",
    items: [
      { id: "data-feeds", label: "Data Feeds", icon: Rss, path: "/data-pipeline" },
      { id: "ingestion", label: "Ingestion Monitor", icon: Database, path: "/accumulation" },
      { id: "health", label: "Health & Status", icon: HeartPulse, path: "/system-status", match: ["/system-status", "/system-pulse", "/infra-ops"] },
      { id: "config", label: "Configuration", icon: Settings, path: "/admin" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    items: [
      { id: "audit-log", label: "Audit Log", icon: ScrollText, path: "/api-audit" },
      { id: "access", label: "Access Control", icon: Lock, path: "/governance" },
      { id: "policy", label: "Policy Center", icon: ShieldCheck, path: "/operational-truth" },
    ],
  },
];

const askItem: NavItem = { id: "ask", label: "Ask AICIS", icon: Brain, path: "/intelligence-engine" };

export const SIDEBAR_WIDTH_EXPANDED = 248;
export const SIDEBAR_WIDTH_COLLAPSED = 56;

export const AICISSidebar = ({ collapsed, onToggle }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: NavItem) => {
    const paths = item.match ?? [item.path];
    return paths.some((p) => location.pathname === p || location.pathname.startsWith(p + "/") || location.pathname === p);
  };

  const handleNavClick = (item: NavItem, closeMobile = false) => {
    navigate(item.path);
    if (closeMobile) onToggle();
  };

  const BadgePill = ({ count, tone }: { count: number; tone: "danger" | "warning" | "info" }) => (
    <span
      className={cn(
        "ml-auto text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md leading-none",
        tone === "danger" && "bg-destructive/15 text-destructive border border-destructive/30",
        tone === "warning" && "bg-amber-500/15 text-amber-500 border border-amber-500/30",
        tone === "info" && "bg-primary/15 text-primary border border-primary/30"
      )}
    >
      {count}
    </span>
  );

  // ---- Desktop: full sidebar (collapsible to icon strip) ----
  const DesktopSidebar = (
    <aside
      role="navigation"
      aria-label="Main navigation"
      style={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      className={cn(
        "fixed left-0 top-12 bottom-0 z-40 bg-card/95 backdrop-blur-sm border-r border-border",
        "hidden md:flex flex-col transition-[width] duration-200 ease-out"
      )}
    >
      {/* Brand block */}
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 h-14 border-b border-border/60 shrink-0",
          collapsed && "justify-center px-0"
        )}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight leading-none">AICIS</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">Planetary Intelligence</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-hide">
        {groups.map((group, gi) => (
          <div key={group.id} className={cn("px-2", gi > 0 && "mt-3")}>
            {!collapsed && (
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {group.label}
              </div>
            )}
            {collapsed && gi > 0 && <div className="my-2 mx-2 h-px bg-border/60" />}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                const button = (
                  <button
                    type="button"
                    onClick={() => handleNavClick(item)}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center w-full h-9 rounded-md text-sm transition-colors min-h-9",
                      collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    )}
                  >
                    {active && !collapsed && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
                    )}
                    <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
                    {!collapsed && (
                      <>
                        <span className="truncate flex-1 text-left">{item.label}</span>
                        {item.badge && <BadgePill {...item.badge} />}
                      </>
                    )}
                    {collapsed && item.badge && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-destructive" />
                    )}
                  </button>
                );
                return collapsed ? (
                  <Tooltip key={item.id} delayDuration={0}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs font-medium">
                      {item.label}
                      {item.badge && <span className="ml-1.5 text-destructive">· {item.badge.count}</span>}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={item.id}>{button}</div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Ask AICIS pinned */}
        <div className="px-2 mt-4">
          {!collapsed && (
            <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              Assistant
            </div>
          )}
          {(() => {
            const Icon = askItem.icon;
            const active = isActive(askItem);
            const btn = (
              <button
                type="button"
                onClick={() => handleNavClick(askItem)}
                aria-label={askItem.label}
                className={cn(
                  "group relative flex items-center w-full h-9 rounded-md text-sm transition-colors",
                  collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                  "bg-primary/5 border border-primary/20 text-primary hover:bg-primary/10",
                  active && "bg-primary/15"
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="truncate flex-1 text-left">Ask AICIS</span>}
              </button>
            );
            return collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side="right" className="text-xs font-medium">Ask AICIS</TooltipContent>
              </Tooltip>
            ) : btn;
          })()}
        </div>
      </nav>

      {/* Footer: version + collapse */}
      <div className="shrink-0 border-t border-border/60">
        {!collapsed && (
          <div className="px-3 pt-2 pb-1 flex items-center gap-2">
            <Gauge className="h-3 w-3 text-primary/70" />
            <span className="text-[10px] text-muted-foreground tabular-nums">AICIS v2.3.0</span>
            <Badge variant="outline" className="ml-auto text-[9px] h-4 px-1 border-primary/30 text-primary/80">LIVE</Badge>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex items-center w-full h-10 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors",
            collapsed ? "justify-center" : "gap-2 px-3"
          )}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );

  // ---- Mobile drawer ----
  const MobileDrawer = !collapsed && (
    <div className="fixed inset-0 z-50 md:hidden" onClick={onToggle}>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      <aside
        className="absolute left-0 top-0 bottom-0 w-[280px] bg-card border-r border-border flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-bold leading-none">AICIS</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Planetary Intelligence</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle} aria-label="Close menu">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {groups.map((group) => (
            <div key={group.id} className="px-2 mb-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
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
                    className={cn(
                      "w-full min-h-11 flex items-center gap-3 px-3 rounded-md text-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/40"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {item.badge && <BadgePill {...item.badge} />}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="px-2 mt-2">
            <button
              type="button"
              onClick={() => handleNavClick(askItem, true)}
              className="w-full min-h-11 flex items-center gap-3 px-3 rounded-md text-sm bg-primary/10 border border-primary/20 text-primary"
            >
              <Brain className="h-4 w-4" />
              <span className="flex-1 text-left">Ask AICIS</span>
            </button>
          </div>
        </nav>
        <div className="border-t border-border px-4 py-2 flex items-center gap-2">
          <Gauge className="h-3 w-3 text-primary/70" />
          <span className="text-[10px] text-muted-foreground">AICIS v2.3.0</span>
          <Badge variant="outline" className="ml-auto text-[9px] h-4 px-1 border-primary/30 text-primary/80">LIVE</Badge>
        </div>
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
