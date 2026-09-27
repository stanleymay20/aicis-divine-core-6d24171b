import {
  ClipboardList,
  Eye,
  Gauge,
  Sparkles,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { cn } from "@/lib/utils";

const modes = [
  {
    label: "Operations",
    path: "/decision-ops",
    aliases: [],
    icon: Gauge,
  },
  {
    label: "Records",
    path: "/decisions",
    aliases: [],
    icon: ClipboardList,
  },
  {
    label: "Watchlist",
    path: "/watchlist",
    aliases: [],
    icon: Eye,
  },
] as const;

const persistedDecisionSearch = (search: string) => {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();

  for (const key of ["entity", "question"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }

  return next.toString();
};

export const DecisionWorkspaceNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedEntity, openAsk } = useIntelligenceOS();

  const navigateMode = (path: string) => {
    const search = persistedDecisionSearch(location.search);
    navigate({
      pathname: path,
      search: search ? `?${search}` : "",
    });
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/35 p-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Decisions workspace
            </span>
            {selectedEntity?.type === "decision" && (
              <Badge
                variant="outline"
                className="max-w-[260px] truncate font-mono text-[9px] text-primary"
                title={`${selectedEntity.type}:${selectedEntity.id}`}
              >
                decision · {selectedEntity.name}
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
                  onClick={() => navigateMode(mode.path)}
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
