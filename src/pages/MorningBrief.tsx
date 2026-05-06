import { AICISLayout } from "@/components/aicis/AICISLayout";
import { MorningBriefDashboard } from "@/components/morning-brief/MorningBriefDashboard";
import { StreamingHealthPanel } from "@/components/live/StreamingHealthPanel";
import { BreakingNowLane } from "@/components/live/BreakingNowLane";

export default function MorningBrief() {
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BreakingNowLane />
          <StreamingHealthPanel />
        </div>
        <MorningBriefDashboard />
      </div>
    </AICISLayout>
  );
}
