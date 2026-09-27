import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  BrainCircuit,
  FlaskConical,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { cn } from "@/lib/utils";

type OpportunitySection = {
  id: string;
  label: string;
  icon: LucideIcon;
};

const sections: OpportunitySection[] = [
  { id: "opportunity-profile", label: "Profile", icon: Target },
  { id: "opportunity-hypotheses", label: "Hypotheses", icon: Sparkles },
  { id: "strategic-research-tracker", label: "Research", icon: Search },
  { id: "opportunity-verification", label: "Verification", icon: ShieldCheck },
  { id: "transaction-path-lab", label: "Transaction", icon: FlaskConical },
  { id: "opportunity-research-queue", label: "Signals", icon: BadgeDollarSign },
];

export const OpportunityWorkspaceNav = () => {
  const { selectedEntity, openAsk } = useIntelligenceOS();
  const [activeSection, setActiveSection] = useState(sections[0].id);

  useEffect(() => {
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((target): target is HTMLElement => Boolean(target));

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveSection(visible.target.id);
        }
      },
      {
        rootMargin: "-12% 0px -68% 0px",
        threshold: [0, 0.15, 0.35, 0.6],
      },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setActiveSection(id);
  };

  return (
    <div className="sticky top-0 z-30 rounded-xl border border-border/70 bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Opportunities workspace
            </span>
            {(selectedEntity?.type === "opportunity" ||
              selectedEntity?.type === "signal") && (
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
            {sections.map((section) => {
              const active = activeSection === section.id;
              const Icon = section.icon;

              return (
                <Button
                  key={section.id}
                  type="button"
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  onClick={() => scrollTo(section.id)}
                  className={cn(
                    "h-8 shrink-0 gap-1.5 px-2.5 text-[11px]",
                    active &&
                      "border border-primary/20 bg-primary/10 text-primary",
                  )}
                  aria-current={active ? "location" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
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
          <BrainCircuit className="h-3.5 w-3.5 text-primary" />
          {selectedEntity ? "Ask about selection" : "Ask AICIS"}
        </Button>
      </div>
    </div>
  );
};
