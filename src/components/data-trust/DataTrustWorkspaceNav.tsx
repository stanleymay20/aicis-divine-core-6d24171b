import {
  Database,
  FileCheck2,
  Globe2,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { useUserRoles } from "@/hooks/useUserRoles";
import { cn } from "@/lib/utils";

type TrustMode = {
  label: string;
  path: string;
  aliases: string[];
  icon: LucideIcon;
  operatorOnly?: boolean;
};

const modes: TrustMode[] = [
  {
    label: "Evidence",
    path: "/evidence-command",
    aliases: ["/daily-evidence-ops"],
    icon: FileCheck2,
  },
  {
    label: "Validation",
    path: "/signal-validation",
    aliases: ["/training-dataset", "/accumulation"],
    icon: ShieldCheck,
  },
  {
    label: "Truth",
    path: "/operational-truth",
    aliases: ["/pilot-truth"],
    icon: Waypoints,
  },
  {
    label: "Coverage",
    path: "/coverage-equity",
    aliases: [],
    icon: Globe2,
  },
  {
    label: "Governance",
    path: "/governance",
    aliases: [],
    icon: Scale,
  },
  {
    label: "Integrity",
    path: "/data-integrity",
    aliases: [],
    icon: Database,
    operatorOnly: true,
  },
];

const persistedTrustSearch = (search: string) => {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();

  for (const key of ["entity", "question"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }

  return next.toString();
};

export const DataTrustWorkspaceNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOperator, isLoading } = useUserRoles();
  const { selectedEntity, openAsk } = useIntelligenceOS();

  const navigateMode = (mode: TrustMode) => {
    if (mode.operatorOnly && !isLoading && !isOperator) return;

    const search = persistedTrustSearch(location.search);
    navigate({
      pathname: mode.path,
      search: search ? `?${search}` : "",
    });
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/35 p-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Data & Trust workspace
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
                mode.aliases.includes(location.pathname);
              const locked =
                mode.operatorOnly && !isLoading && !isOperator;
              const Icon = mode.icon;

              return (
                <Button
                  key={mode.path}
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => navigateMode(mode)}
                  disabled={locked}
                  className={cn(
                    "h-8 shrink-0 gap-1.5 px-2.5 text-[11px]",
                    active &&
                      "border border-primary/20 bg-primary/10 text-primary",
                  )}
                  aria-current={active ? "page" : undefined}
                  title={locked ? "Operator or admin role required" : undefined}
                >
                  {locked ? (
                    <LockKeyhole className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
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
