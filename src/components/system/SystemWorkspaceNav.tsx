import {
  Activity,
  Code2,
  Download,
  LockKeyhole,
  Network,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { useUserRoles } from "@/hooks/useUserRoles";
import { cn } from "@/lib/utils";

type SystemMode = {
  label: string;
  path: string;
  aliases: string[];
  icon: LucideIcon;
  operatorOnly?: boolean;
  adminOnly?: boolean;
};

const modes: SystemMode[] = [
  {
    label: "Status",
    path: "/system-pulse",
    aliases: ["/system-status", "/system-catalog"],
    icon: Activity,
  },
  {
    label: "Operations",
    path: "/infra-ops",
    aliases: ["/data-pipeline"],
    icon: Server,
    operatorOnly: true,
  },
  {
    label: "Developers",
    path: "/developers",
    aliases: ["/api-audit"],
    icon: Code2,
  },
  {
    label: "Exports",
    path: "/export-center",
    aliases: [
      "/data-export",
      "/export-layer",
      "/exports",
      "/quantivis-exports",
      "/admin/export-center",
    ],
    icon: Download,
  },
  {
    label: "Federation",
    path: "/register-node",
    aliases: ["/federation-admin"],
    icon: Network,
  },
  {
    label: "Admin",
    path: "/admin",
    aliases: [],
    icon: ShieldCheck,
    adminOnly: true,
  },
];

const persistedSystemSearch = (search: string) => {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();

  for (const key of ["entity", "question"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }

  return next.toString();
};

export const SystemWorkspaceNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin, isOperator, isLoading } = useUserRoles();
  const { selectedEntity, openAsk } = useIntelligenceOS();

  const navigateMode = (mode: SystemMode) => {
    const locked =
      (mode.adminOnly && !isAdmin) ||
      (mode.operatorOnly && !isOperator);

    if (!isLoading && locked) return;

    const search = persistedSystemSearch(location.search);
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
              System workspace
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
                !isLoading &&
                ((mode.adminOnly && !isAdmin) ||
                  (mode.operatorOnly && !isOperator));
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
                  title={
                    locked
                      ? mode.adminOnly
                        ? "Admin role required"
                        : "Operator or admin role required"
                      : undefined
                  }
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
