import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, PlayCircle, BarChart3, Beaker, Flame, Target } from "lucide-react";
import DailyTaskPanel from "@/components/decision-engine/DailyTaskPanel";
import ExecutionCommandCenter from "@/components/decision-engine/ExecutionCommandCenter";
import OutcomeInputPanel from "@/components/decision-engine/OutcomeInputPanel";
import PilotModePanel from "@/components/decision-engine/PilotModePanel";
import OutcomeBacklogBurner from "@/components/decision-engine/OutcomeBacklogBurner";
import MeasuredOutcomeKPI from "@/components/decision-engine/MeasuredOutcomeKPI";

export default function DecisionOperations() {
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto animate-fade-in">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Decisions
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track decisions from signal to outcome. Execute, measure, and prove value.
          </p>
        </div>

        <DailyTaskPanel />
        <MeasuredOutcomeKPI />

        <Tabs defaultValue="execution" className="w-full">
          <TabsList className="bg-muted/50 p-0.5 h-auto flex-wrap">
            <TabsTrigger value="backlog" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <Flame className="h-3.5 w-3.5" /> Backlog
            </TabsTrigger>
            <TabsTrigger value="execution" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <PlayCircle className="h-3.5 w-3.5" /> Execution
            </TabsTrigger>
            <TabsTrigger value="outcomes" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <BarChart3 className="h-3.5 w-3.5" /> Outcomes
            </TabsTrigger>
            <TabsTrigger value="pilot" className="text-xs gap-1.5 data-[state=active]:bg-card">
              <Beaker className="h-3.5 w-3.5" /> Pilot Report
            </TabsTrigger>
          </TabsList>

          <TabsContent value="backlog" className="mt-4">
            <OutcomeBacklogBurner />
          </TabsContent>
          <TabsContent value="execution" className="mt-4">
            <ExecutionCommandCenter />
          </TabsContent>
          <TabsContent value="outcomes" className="mt-4">
            <OutcomeInputPanel />
          </TabsContent>
          <TabsContent value="pilot" className="mt-4">
            <PilotModePanel />
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
}
