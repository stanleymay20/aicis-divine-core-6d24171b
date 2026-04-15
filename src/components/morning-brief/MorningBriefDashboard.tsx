import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ChevronDown, ChevronUp, Radio, Activity, TrendingUp, Layers,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PriorityDecisionsPanel } from "./PriorityDecisionsPanel";
import { GlobalSignalsBrief } from "./GlobalSignalsBrief";
import { SystemHealthBadge } from "./SystemHealthBadge";
import { SignalDrillDown } from "@/components/command-center/SignalDrillDown";
import { useNavigate } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BusinessExposureStrip } from "./BusinessExposureStrip";
import { ActionsAwaitingStrip } from "./ActionsAwaitingStrip";
import { ExecutiveProofPanel } from "./ExecutiveProofPanel";
import { RecentDecisionsWidget } from "./RecentDecisionsWidget";
import { TopRisksWidget } from "./TopRisksWidget";
import { WatchlistBriefWidget } from "@/components/watchlist/WatchlistBriefWidget";
import { SystemStatusStrip } from "./SystemStatusStrip";

export const MorningBriefDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedSignal, setSelectedSignal] = useState<any>(null);
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
    staleTime: 300_000,
  });

  const firstName = profile?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "Operator";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  const handleSignalClick = (signal: any) => {
    setSelectedSignal(signal);
    setDrillDownOpen(true);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── HERO: What + When + System Health ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold leading-tight">
            {greeting}, {firstName}.
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's what needs your attention.
          </p>
          <p className="text-[11px] text-muted-foreground">
            {format(new Date(), "EEEE, MMMM d · HH:mm")} UTC
          </p>
        </div>
        <SystemHealthBadge />
      </div>

      {/* ── EXPOSURE: 3-4 compact KPIs ── */}
      <BusinessExposureStrip />

      {/* ── TOP RISKS: 3-5 critical signals with impact + action ── */}
      <GlobalSignalsBrief onSignalClick={handleSignalClick} />

      {/* ── PRIORITY ACTIONS: What to do now ── */}
      <PriorityDecisionsPanel />

      {/* ── PROGRESSIVE DISCLOSURE: Everything else ── */}
      <Collapsible open={showMore} onOpenChange={setShowMore}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground gap-2"
          >
            {showMore ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Hide details
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                View more: tracked markets, recent decisions, system status
              </>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-3">
          <WatchlistBriefWidget />
          <RecentDecisionsWidget />
          <ExecutiveProofPanel />
          <TopRisksWidget />
          <SystemStatusStrip />

          {/* Quick Actions */}
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">What To Do Next</h3>
              <div className="grid sm:grid-cols-2 gap-2">
                <ActionCard
                  icon={<Radio className="h-4 w-4 text-primary" />}
                  title="Review Risks"
                  desc="Check new supply chain risks"
                  onClick={() => navigate("/live")}
                />
                <ActionCard
                  icon={<Activity className="h-4 w-4 text-primary" />}
                  title="Execute Actions"
                  desc="Act on open items"
                  onClick={() => navigate("/decision-ops")}
                />
                <ActionCard
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  title="Record Outcomes"
                  desc="Close the loop with evidence"
                  onClick={() => navigate("/evidence-command")}
                />
                <ActionCard
                  icon={<Layers className="h-4 w-4 text-primary" />}
                  title="Risk Atlas"
                  desc="Country & region exposure"
                  onClick={() => navigate("/risk-atlas")}
                />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <SignalDrillDown
        signal={selectedSignal}
        open={drillDownOpen}
        onOpenChange={setDrillDownOpen}
      />
    </div>
  );
};

const ActionCard = ({ icon, title, desc, onClick }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-left group"
  >
    <div className="shrink-0">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium group-hover:text-primary transition-colors">{title}</p>
      <p className="text-[11px] text-muted-foreground">{desc}</p>
    </div>
    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
  </button>
);
