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
  TrendingUp,
  Shield,
  Settings,
  Code2,
  X,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const navItems = [
  { id: "brief", label: "Today's Brief", icon: Sunrise, path: "/morning-brief" },
  { id: "signals", label: "Live Signals", icon: Radio, path: "/live" },
  { id: "decisions", label: "Decisions", icon: Activity, path: "/decision-ops" },
  { id: "outcomes", label: "Outcomes", icon: TrendingUp, path: "/evidence-command" },
  { id: "governance", label: "Governance", icon: Shield, path: "/governance" },
  { id: "developers", label: "Developers", icon: Code2, path: "/developers" },
  { id: "settings", label: "Settings", icon: Settings, path: "/admin" },
];

export const AICISSidebar = ({ collapsed, onToggle, activeSection, onSectionChange }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavClick = (item: typeof navItems[0]) => {
    onSectionChange(item.id);
    navigate(item.path);
  };

  const isActive = (item: typeof navItems[0]) => {
    if (item.path !== "/" && location.pathname.startsWith(item.path)) return true;
    return false;
  };

  return (
    <TooltipProvider>
      {/* Desktop — icon-only rail */}
      <aside
        role="navigation"
        aria-label="Main navigation"
        className="fixed left-0 top-12 bottom-0 z-40 w-[52px] bg-card border-r border-border hidden md:flex flex-col items-center py-4 overflow-y-auto scrollbar-hide"
      >
        <nav className="flex flex-col gap-1 w-full px-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Tooltip key={item.id} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
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
          })}
        </nav>
      </aside>

      {/* Mobile overlay */}
      {!collapsed && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={onToggle}>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 bottom-0 w-[240px] bg-card border-r border-border flex flex-col"
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
              {navItems.map((item) => {
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
              })}
            </nav>
          </aside>
        </div>
      )}
    </TooltipProvider>
  );
};
