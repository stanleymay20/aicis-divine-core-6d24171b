import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  BrainCircuit,
  DatabaseZap,
  Globe2,
  LayoutDashboard,
  ShieldCheck,
  Target,
  TrendingUp,
  Workflow,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { useUserRoles } from "@/hooks/useUserRoles";

const baseWorkspaces = [
  { label: "World", path: "/world", icon: Globe2, keywords: "map live signals global" },
  { label: "Brief", path: "/morning-brief", icon: LayoutDashboard, keywords: "morning executive synthesis" },
  { label: "Analysis", path: "/analyst", icon: BarChart3, keywords: "research graph deep dive" },
  { label: "Forecasts", path: "/forecast-validation", icon: Target, keywords: "prediction scenario outcome" },
  { label: "Opportunities", path: "/opportunities", icon: TrendingUp, keywords: "opportunity research ranking" },
  { label: "Decisions", path: "/decision-ops", icon: Workflow, keywords: "decisions watchlist monitoring" },
  { label: "Data & Trust", path: "/governance", icon: ShieldCheck, keywords: "evidence provenance integrity" },
] as const;

export const AICISCommandPalette = () => {
  const navigate = useNavigate();
  const { isCommandPaletteOpen, setCommandPaletteOpen, openAsk } = useIntelligenceOS();
  const { isAdmin, isOperator } = useUserRoles();

  const workspaces = useMemo(
    () =>
      isAdmin || isOperator
        ? [
            ...baseWorkspaces,
            {
              label: "System",
              path: "/system-pulse",
              icon: DatabaseZap,
              keywords: "pipelines operations admin health",
            },
          ]
        : baseWorkspaces,
    [isAdmin, isOperator],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  const go = (path: string) => {
    setCommandPaletteOpen(false);
    navigate(path);
  };

  return (
    <CommandDialog open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Search workspaces or run a command…" />
      <CommandList>
        <CommandEmpty>No matching AICIS command.</CommandEmpty>
        <CommandGroup heading="Intelligence">
          <CommandItem
            value="Ask AICIS contextual intelligence research"
            onSelect={() => {
              setCommandPaletteOpen(false);
              openAsk();
            }}
          >
            <BrainCircuit className="mr-2 h-4 w-4 text-primary" />
            Ask AICIS
            <CommandShortcut>AI</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Workspaces">
          {workspaces.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.path}
                value={item.label + " " + item.keywords}
                onSelect={() => go(item.path)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
