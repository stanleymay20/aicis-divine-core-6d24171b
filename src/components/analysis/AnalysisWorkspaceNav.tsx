import {
  BrainCircuit,
  Globe2,
  LayoutDashboard,
  Network,
  Sparkles,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { cn } from "@/lib/utils";

const modes = [
  {
    label: "Overview",
    path: "/analyst",
    aliases: ["/analyst-dashboard"],
    icon: LayoutDashboard,
  },
  {
    label: "Cognitive Core",
    path: "/intelligence-engine",
    aliases: [],
    icon: BrainCircuit,
  },
  {
    label: "Graph",
    path: "/planetary-graph",
    aliases: [],
    icon: Network,
  },
  {
    label: "Geography",
    path: "/resolution",
    aliases: [],
    icon: Globe2,
  },
] as const;

export const AnalysisWorkspaceNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedEntity, openAsk } = useIntelligenceOS();

  return (
    <div className="rounded-xl border border-border/70 bg-card/35 p-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Analysis workspace
            </span>
            {selectedEntity && (
              <Badge
                variant="outline"
                className="max-w-[260px] truncate font-mono text-[9px] text-primary"
                title={`${selectedEntity.type}:${selectedEntity.id}`}
              >
                {selectedEntity.type} · {selectedEntity.name}
              </Badge>
            )}
          </div>

          <div className="flex min-w-0 gap-1 overflow-x-auto scrollbar-hide">
            {modes.map((mode) => {
              const active =
                location.pathname === mode.path ||
                (mode.aliases as readonly string[]).includes(location.pathname);
              const Icon = mode.icon;

              return (
                <Button
                  key={mode.path}
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => navigate(mode.path)}
                  className={cn(
                    "h-8 shrink-0 gap-1.5 px-2.5 text-[11px]",
                    active &&
                      "border border-primary/20 bg-primary/10 text-primary",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {mode.label}
                </Button>
              );
            })}
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={openAsk}
          className="h-8 shrink-0 gap-1.5 text-[11px]"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {selectedEntity ? "Ask about selection" : "Ask AICIS"}
        </Button>
      </div>
    </div>
  );
};
