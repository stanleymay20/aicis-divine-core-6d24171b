import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sunrise,
  Radio,
  Activity,
  X,
  Globe,
  LayoutGrid,
  Search,
  Eye,
  Shield,
  Server,
  Command,
} from "lucide-react";
import { useUserRoles } from "@/hooks/useUserRoles";

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
  group?: "primary" | "operator" | "admin";
};

const primaryItems: NavItem[] = [
  { id: "command", label: "Command Center", icon: Command, path: "/command-center", group: "primary" },
  { id: "brief", label: "Brief", icon: Sunrise, path: "/morning-brief", group: "primary" },
  { id: "signals", label: "Signals", icon: Radio, path: "/live", group: "primary" },
  { id: "decisions", label: "Decisions", icon: Activity, path: "/decision-ops", group: "primary" },
  { id: "atlas", label: "Atlas", icon: Globe, path: "/risk-atlas", group: "primary" },
  { id: "ask", label: "Ask AICIS", icon: Search, path: "/intelligence-engine", group: "primary" },
  { id: "watchlist", label: "Watchlist", icon: Eye, path: "/watchlist", group: "primary" },
];

const operatorItems: NavItem[] = [
  { id: "ops", label: "Operator Console", icon: LayoutGrid, path: "/advanced", group: "operator" },
];

const adminItems: NavItem[] = [
  { id: "admin", label: "System Admin", icon: Shield, path: "/admin", group: "admin" },
  { id: "pipeline", label: "Pipeline Health", icon: Server, path: "/data-pipeline", group: "admin" },
];

export const AICISSidebar = ({ collapsed, onToggle, activeSection, onSectionChange }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isOperator } = useUserRoles();

  const handleNavClick = (item: NavItem) => {
    onSectionChange(item.id);
    navigate(item.path);
  };

  const isActive = (item: NavItem) => {
    if (item.path !== "/" && location.pathname.startsWith(item.path)) return true;
    if (item.id === "ask" && location.pathname.startsWith("/intelligence-engine")) return true;
    if (item.id === "ops" && ["/advanced", "/live-stream", "/signal-validation", "/simulation", "/predictions", "/local-events"].some((p) => location.pathname.startsWith(p))) return true;
    if (item.id === "admin" && ["/admin", "/developers", "/data-export", "/api-audit", "/infra-ops", "/system-pulse"].some((p) => location.pathname.startsWith(p))) return true;
    return false;
  };

  const renderDesktopItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item);
    return (
      <Tooltip key={item.id} delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={item.label}
            className={cn(
              "w-9 h-9 rounded-lg mx-auto",
              active && "bg-primary/10 text-primary",
              !active && "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            onClick={() => handleNavClick(item)}
          >
            <Icon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs font-medium">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderMobileItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item);
    return (
      <Button
        key={item.id}
        variant="ghost"
        className={cn(
          "w-full h-11 justify-start gap-3 text-sm rounded-none px-4",
          active && "bg-primary/10 text-primary border-r-2 border-primary",
          !active && "text-muted-foreground hover:text-foreground hover:bg-muted/30"
        )}
        onClick={() => { handleNavClick(item); onToggle(); }}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {item.label}
      </Button>
    );
  };

  return (
    <TooltipProvider>
      <aside
        role="navigation"
        aria-label="Main navigation"
        className="fixed left-0 top-12 bottom-0 z-40 w-[52px] bg-card border-r border-border hidden md:flex flex-col items-center py-4 overflow-y-auto scrollbar-hide"
      >
        <nav className="flex flex-col gap-1 w-full px-1.5">
          {primaryItems.map(renderDesktopItem)}
          {isOperator && <div className="my-2 h-px bg-border/70 mx-2" />}
          {isOperator && operatorItems.map(renderDesktopItem)}
          {isAdmin && <div className="my-2 h-px bg-border/70 mx-2" />}
          {isAdmin && adminItems.map(renderDesktopItem)}
        </nav>
      </aside>

      {!collapsed && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={onToggle}>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 bottom-0 w-[260px] bg-card border-r border-border flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <span className="text-primary font-bold text-[10px]">AI</span>
                </div>
                <span className="text-sm font-semibold">AICIS</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Command</div>
              {primaryItems.map(renderMobileItem)}
              {isOperator && (
                <>
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Operator</div>
                  {operatorItems.map(renderMobileItem)}
                </>
              )}
              {isAdmin && (
                <>
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Admin</div>
                  {adminItems.map(renderMobileItem)}
                </>
              )}
            </nav>
          </aside>
        </div>
      )}
    </TooltipProvider>
  );
};
