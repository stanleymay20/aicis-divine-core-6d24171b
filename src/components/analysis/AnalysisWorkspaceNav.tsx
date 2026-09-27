import { useEffect, useState } from "react";
import {
  BrainCircuit,
  Globe2,
  LayoutDashboard,
  Network,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const persistedSearch = (search: string) => {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();

  for (const key of ["entity", "question"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }

  return next.toString();
};

export const AnalysisWorkspaceNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedEntity, openAsk } = useIntelligenceOS();
  const [questionDraft, setQuestionDraft] = useState(
    () => new URLSearchParams(location.search).get("question") ?? "",
  );

  useEffect(() => {
    setQuestionDraft(
      new URLSearchParams(location.search).get("question") ?? "",
    );
  }, [location.search]);

  const navigateMode = (path: string) => {
    const search = persistedSearch(location.search);
    navigate({
      pathname: path,
      search: search ? `?${search}` : "",
    });
  };

  const commitQuestion = () => {
    const next = new URLSearchParams(location.search);
    const question = questionDraft.trim();

    if (question) next.set("question", question);
    else next.delete("question");

    navigate(
      {
        pathname: location.pathname,
        search: next.toString() ? `?${next.toString()}` : "",
      },
      { replace: true },
    );
  };

  const clearQuestion = () => {
    setQuestionDraft("");
    const next = new URLSearchParams(location.search);
    next.delete("question");
    navigate(
      {
        pathname: location.pathname,
        search: next.toString() ? `?${next.toString()}` : "",
      },
      { replace: true },
    );
  };

  const activeQuestion =
    new URLSearchParams(location.search).get("question")?.trim() ?? "";

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

      <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={questionDraft}
            onChange={(event) => setQuestionDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitQuestion();
            }}
            placeholder={
              selectedEntity
                ? `Investigation question about ${selectedEntity.name}…`
                : "Investigation question…"
            }
            className="h-8 pl-8 text-xs"
            aria-label="Analysis investigation question"
          />
        </div>

        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            onClick={commitQuestion}
            disabled={!questionDraft.trim()}
            className="h-8 text-[11px]"
          >
            Set question
          </Button>
          {activeQuestion && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={clearQuestion}
              className="h-8 w-8"
              aria-label="Clear investigation question"
              title="Clear investigation question"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {activeQuestion && (
        <div className="mt-2 rounded-md border border-primary/15 bg-primary/[0.035] px-3 py-2">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
            Active investigation
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-foreground">
            {activeQuestion}
          </p>
        </div>
      )}
    </div>
  );
};
