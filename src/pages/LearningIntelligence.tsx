import { AICISLayout } from "@/components/aicis/AICISLayout";
import { LearningDashboard } from "@/components/learning/LearningDashboard";

export default function LearningIntelligence() {
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full">
        <LearningDashboard />
      </div>
    </AICISLayout>
  );
}
