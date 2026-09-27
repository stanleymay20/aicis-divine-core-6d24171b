import {
  BrainCircuit,
  ChevronLeft,
  CircleHelp,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { InspectorTab } from "@/types/intelligence-os";
import { AskAICISPanel } from "@/components/aicis/intelligence/AskAICISPanel";
import { ConfidenceBadge } from "@/components/aicis/trust/ConfidenceBadge";
import { EvidenceCoverage } from "@/components/aicis/trust/EvidenceCoverage";
import { FreshnessBadge } from "@/components/aicis/trust/FreshnessBadge";

const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "signals", label: "Signals" },
  { id: "forecasts", label: "Forecasts" },
  { id: "relationships", label: "Relations" },
  { id: "history", label: "History" },
  { id: "ask", label: "Ask" },
];

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed border-border p-4 text-[11px] leading-relaxed text-muted-foreground">
    {children}
  </div>
);

const InspectorBody = () => {
  const { selectedEntity, activeInspectorTab, setInspectorTab, clearEntity } = useIntelligenceOS();

  const content = () => {
    if (activeInspectorTab === "ask") return <AskAICISPanel />;

    if (!selectedEntity) {
      return (
        <EmptyState>
          Select a country, signal, forecast, opportunity, risk, decision, source, or pipeline to establish intelligence context.
        </EmptyState>
      );
    }

    if (activeInspectorTab === "overview") {
      return (
        <div className="space-y-4">
          {selectedEntity.description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{selectedEntity.description}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <ConfidenceBadge value={selectedEntity.confidence} />
            <FreshnessBadge timestamp={selectedEntity.updatedAt ?? selectedEntity.observedAt} />
          </div>
          <EvidenceCoverage value={selectedEntity.evidenceCoverage} sourceCount={selectedEntity.sourceCount} />
          {selectedEntity.geography && (
            <div className="rounded-lg border border-border/70 p-3 text-[11px]">
              <div className="mb-2 font-medium text-foreground">Geography</div>
              <div className="space-y-1 text-muted-foreground">
                {selectedEntity.geography.country && <div>Country · {selectedEntity.geography.country}</div>}
                {selectedEntity.geography.region && <div>Region · {selectedEntity.geography.region}</div>}
                {selectedEntity.geography.locality && <div>Locality · {selectedEntity.geography.locality}</div>}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeInspectorTab === "evidence") {
      if (!selectedEntity.provenance?.length) {
        return <EmptyState>No provenance summary has been supplied for this entity yet.</EmptyState>;
      }
      return (
        <div className="space-y-2">
          {selectedEntity.provenance.map((source) => (
            <div key={source.id} className="rounded-lg border border-border/70 p-3 text-[11px]">
              <div className="font-medium text-foreground">{source.label}</div>
              <div className="mt-1 text-muted-foreground">
                {source.sourceType ?? "Source"}
                {source.observedAt ? " · " + source.observedAt : ""}
              </div>
            </div>
          ))}
        </div>
      );
    }

    const messages: Record<Exclude<InspectorTab, "overview" | "evidence" | "ask">, string> = {
      signals: "Related signals will appear here when the selected workspace supplies them.",
      forecasts: "Related forecasts will appear here with probability, horizon, evidence, and revision history.",
      relationships: "Entity relationships will appear here when graph context is available.",
      history: "Observation and change history will appear here when timeline context is available.",
    };

    return <EmptyState>{messages[activeInspectorTab]}</EmptyState>;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/70 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Intelligence context
            </div>
            <div className="mt-1 truncate text-sm font-semibold">
              {selectedEntity?.name ?? "Ask AICIS"}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {selectedEntity?.type ?? "No entity selected"}
            </div>
          </div>
          {selectedEntity && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={clearEntity} aria-label="Clear selected entity">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="shrink-0 overflow-x-auto border-b border-border/70 px-2 py-2 scrollbar-hide">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setInspectorTab(tab.id)}
              className={cn(
                "rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors",
                activeInspectorTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">{content()}</div>
    </div>
  );
};

export const IntelligenceInspector = () => {
  const isMobile = useIsMobile();
  const { isInspectorOpen, openInspector, closeInspector, selectedEntity } = useIntelligenceOS();

  if (isMobile) {
    return (
      <Drawer open={isInspectorOpen} onOpenChange={(open) => (open ? openInspector() : closeInspector())}>
        <DrawerContent className="max-h-[82vh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>AICIS Intelligence Inspector</DrawerTitle>
            <DrawerDescription>Context, evidence, forecasts and Ask AICIS.</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <InspectorBody />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  if (!isInspectorOpen) {
    return (
      <aside className="hidden w-11 shrink-0 border-l border-border/70 bg-background/94 md:flex md:flex-col md:items-center md:py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => openInspector(selectedEntity ? "overview" : "ask")}
          aria-label="Open intelligence inspector"
          title="Open intelligence inspector"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
        <div className="mt-3 [writing-mode:vertical-rl] rotate-180 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          Intelligence
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[360px] shrink-0 border-l border-border/70 bg-background/96 md:flex md:flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/70 px-2">
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          {selectedEntity ? <ChevronLeft className="h-3 w-3" /> : <CircleHelp className="h-3 w-3" />}
          {selectedEntity ? "Selected intelligence object" : "General intelligence"}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeInspector} aria-label="Close intelligence inspector">
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <InspectorBody />
      </div>
    </aside>
  );
};
