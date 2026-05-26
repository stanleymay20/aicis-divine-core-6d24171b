import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Cpu } from "lucide-react";
import TrustScorePanel from "@/components/decision-engine/TrustScorePanel";
import BaselineComparison from "@/components/decision-engine/BaselineComparison";
import ModelSafetyPanel from "@/components/decision-engine/ModelSafetyPanel";
import SilentFailurePanel from "@/components/decision-engine/SilentFailurePanel";
import ExecutionPipelinePanel from "@/components/decision-engine/ExecutionPipelinePanel";
import MeasuredEvidenceProgressPanel from "@/components/decision-engine/MeasuredEvidenceProgressPanel";
import ReviewerAccountabilityPanel from "@/components/decision-engine/ReviewerAccountabilityPanel";
import ActionLeaderboard from "@/components/decision-engine/ActionLeaderboard";
import DecisionKPIPanel from "@/components/decision-engine/DecisionKPIPanel";
import ModelPromotionLog from "@/components/decision-engine/ModelPromotionLog";
import LearningCycleHealth from "@/components/decision-engine/LearningCycleHealth";
import InferenceActivityPanel from "@/components/decision-engine/InferenceActivityPanel";
import PromotionReadinessGate from "@/components/decision-engine/PromotionReadinessGate";
import EvidenceBacklogQueue from "@/components/decision-engine/EvidenceBacklogQueue";
import BillingHealthPanel from "@/components/decision-engine/BillingHealthPanel";
import AuditActivityPanel from "@/components/decision-engine/AuditActivityPanel";
import { PanelBoundary } from "@/components/ui/panel-boundary";

export default function OperationalTruth() {
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto animate-fade-in">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            Operational Truth
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Single-pane system health — every claim backed by live data
          </p>
        </div>

        {/* Row 1: Model Safety + Trust */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PanelBoundary><ModelSafetyPanel /></PanelBoundary>
          <PanelBoundary><TrustScorePanel /></PanelBoundary>
        </div>

        {/* Row 2: Promotion Gate + Silent Failures */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PanelBoundary><PromotionReadinessGate /></PanelBoundary>
          <PanelBoundary><SilentFailurePanel /></PanelBoundary>
        </div>

        {/* Row 3: Inference Activity */}
        <PanelBoundary><InferenceActivityPanel /></PanelBoundary>

        {/* Row 4: Evidence Funnel + Execution Pipeline */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PanelBoundary><MeasuredEvidenceProgressPanel /></PanelBoundary>
          <PanelBoundary><ExecutionPipelinePanel /></PanelBoundary>
        </div>

        {/* Row 5: KPIs + Baseline */}
        <PanelBoundary><DecisionKPIPanel /></PanelBoundary>
        <BaselineComparison />

        {/* Row 6: Evidence Backlog */}
        <PanelBoundary><EvidenceBacklogQueue /></PanelBoundary>

        {/* Row 7: Reviewer + Leaderboard */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PanelBoundary><ReviewerAccountabilityPanel /></PanelBoundary>
          <ActionLeaderboard />
        </div>

        {/* Row 8: Billing + Audit */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PanelBoundary><BillingHealthPanel /></PanelBoundary>
          <PanelBoundary><AuditActivityPanel /></PanelBoundary>
        </div>

        {/* Row 9: Model History + Learning */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PanelBoundary><ModelPromotionLog /></PanelBoundary>
          <LearningCycleHealth />
        </div>
      </div>
    </AICISLayout>
  );
}
