import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, PlayCircle, BarChart3, Beaker, Flame, Inbox, ListChecks, Sparkles } from "lucide-react";
import DailyTaskPanel from "@/components/decision-engine/DailyTaskPanel";
import ExecutionCommandCenter from "@/components/decision-engine/ExecutionCommandCenter";
import OutcomeInputPanel from "@/components/decision-engine/OutcomeInputPanel";
import PilotModePanel from "@/components/decision-engine/PilotModePanel";
import OutcomeBacklogBurner from "@/components/decision-engine/OutcomeBacklogBurner";
import MeasuredOutcomeKPI from "@/components/decision-engine/MeasuredOutcomeKPI";
import DecisionReviewQueue from "@/components/decision-engine/DecisionReviewQueue";
import { RecommendedActionsPanel } from "@/components/risk-ranking/RecommendedActionsPanel";
import { DecisionOpsKPIStrip } from "@/components/decision-engine/DecisionOpsKPIStrip";
import { PanelBoundary } from "@/components/ui/panel-boundary";

export default function DecisionOperations() {
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-5 max-w-[1400px] mx-auto animate-fade-in overflow-y-auto h-full">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Actions & Outcomes
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Decisions that protect margin, continuity, and delivery performance. Execute, measure, and prove savings.
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border rounded px-2 py-1">
            Live · auto-refresh 30s
          </span>
        </div>

        <DecisionOpsKPIStrip />

        <Tabs defaultValue="today" className="w-full">
          <TabsList className="bg-muted/50 p-0.5 h-auto flex-wrap">
            <TabsTrigger value="today" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <Inbox className="h-3.5 w-3.5" /> Today's queue
            </TabsTrigger>
            <TabsTrigger value="recommended" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <Sparkles className="h-3.5 w-3.5" /> Recommended
            </TabsTrigger>
            <TabsTrigger value="review" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <ListChecks className="h-3.5 w-3.5" /> Review queue
            </TabsTrigger>
            <TabsTrigger value="execution" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <PlayCircle className="h-3.5 w-3.5" /> Execute now
            </TabsTrigger>
            <TabsTrigger value="backlog" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <Flame className="h-3.5 w-3.5" /> Backlog burner
            </TabsTrigger>
            <TabsTrigger value="outcomes" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <BarChart3 className="h-3.5 w-3.5" /> Recorded outcomes
            </TabsTrigger>
            <TabsTrigger value="pilot" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <Beaker className="h-3.5 w-3.5" /> Pilot program
            </TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="mt-4 space-y-5">
            <PanelBoundary><DailyTaskPanel /></PanelBoundary>
            <PanelBoundary><MeasuredOutcomeKPI /></PanelBoundary>
          </TabsContent>
          <TabsContent value="recommended" className="mt-4">
            <PanelBoundary><RecommendedActionsPanel topN={20} /></PanelBoundary>
          </TabsContent>
          <TabsContent value="review" className="mt-4">
            <PanelBoundary><DecisionReviewQueue /></PanelBoundary>
          </TabsContent>
          <TabsContent value="execution" className="mt-4">
            <PanelBoundary><ExecutionCommandCenter /></PanelBoundary>
          </TabsContent>
          <TabsContent value="backlog" className="mt-4">
            <OutcomeBacklogBurner />
          </TabsContent>
          <TabsContent value="outcomes" className="mt-4">
            <PanelBoundary><OutcomeInputPanel /></PanelBoundary>
          </TabsContent>
          <TabsContent value="pilot" className="mt-4">
            <PanelBoundary><PilotModePanel /></PanelBoundary>
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
}
