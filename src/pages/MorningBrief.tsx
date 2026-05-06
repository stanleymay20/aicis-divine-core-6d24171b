import { useState } from "react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { MorningBriefDashboard } from "@/components/morning-brief/MorningBriefDashboard";
import { StreamingHealthPanel } from "@/components/live/StreamingHealthPanel";
import { BreakingNowLane } from "@/components/live/BreakingNowLane";
import { SignalRecommendationsLane } from "@/components/live/SignalRecommendationsLane";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Radio } from "lucide-react";

export default function MorningBrief() {
  const [showLive, setShowLive] = useState(false);

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-4">
        {/* Primary brief — what the operator must act on today */}
        <MorningBriefDashboard />

        {/* Live operations — collapsed by default to keep the brief calm */}
        <Collapsible open={showLive} onOpenChange={setShowLive}>
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between gap-2 text-muted-foreground hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                <Radio className="h-4 w-4" />
                Live operations: breaking signals, streaming health, recommendations
              </span>
              {showLive ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BreakingNowLane />
              <StreamingHealthPanel />
            </div>
            <SignalRecommendationsLane topN={20} />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </AICISLayout>
  );
}
