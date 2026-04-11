import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sunrise, ArrowRight, CheckCircle2, Radio, Activity, TrendingUp, Layers,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PriorityDecisionsPanel } from "./PriorityDecisionsPanel";
import { ExecutiveProofPanel } from "./ExecutiveProofPanel";
import { GlobalSignalsBrief } from "./GlobalSignalsBrief";
import { RecentDecisionsWidget } from "./RecentDecisionsWidget";
import { TopRisksWidget } from "./TopRisksWidget";
import { SystemStatusStrip } from "./SystemStatusStrip";
import { SystemHealthBadge } from "./SystemHealthBadge";
import { WatchlistBriefWidget } from "@/components/watchlist/WatchlistBriefWidget";
import { BusinessExposureStrip } from "./BusinessExposureStrip";
import { SignalDrillDown } from "@/components/command-center/SignalDrillDown";
import { useNavigate } from "react-router-dom";

export const MorningBriefDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedSignal, setSelectedSignal] = useState<any>(null);
  const [drillDownOpen, setDrillDownOpen] = useState(false);

  // Fetch user profile for greeting
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
  const greeting = new Date().getHours() < 12 ? "Good Morning" : new Date().getHours() < 18 ? "Good Afternoon" : "Good Evening";

  const handleSignalClick = (signal: any) => {
    setSelectedSignal(signal);
    setDrillDownOpen(true);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── A. HERO HEADER ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold leading-tight">
            {greeting}, {firstName}.
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's what you need to know today.
          </p>
          <p className="text-[11px] text-muted-foreground">{format(new Date(), "EEEE, MMMM d · HH:mm")} UTC</p>
        </div>
        <SystemHealthBadge />
      </div>

      {/* ── SYSTEM STATUS STRIP ── */}
      <SystemStatusStrip />

      {/* ── B. BUSINESS EXPOSURE STRIP ── */}
      <BusinessExposureStrip />

      {/* ── C. CRITICAL RISKS / TOP SIGNALS ── */}
      <GlobalSignalsBrief onSignalClick={handleSignalClick} />

      {/* ── D+E. BUSINESS IMPACT + RECOMMENDED ACTIONS ── */}
      <PriorityDecisionsPanel onSignalClick={handleSignalClick} />

      {/* ── TRACKED MARKETS ── */}
      <WatchlistBriefWidget />

      {/* ── F. RECENT DECISIONS & OUTCOMES ── */}
      <RecentDecisionsWidget />

      {/* ── PROVEN VALUE ── */}
      <ExecutiveProofPanel />

      {/* ── TOP RISK MARKETS ── */}
      <TopRisksWidget />

      {/* ── QUICK ACTIONS ── */}
      <Card className="border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            What To Do Next
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
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
              title="Risk Map"
              desc="Country & region exposure"
              onClick={() => navigate("/resolution")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Signal Drill-Down Panel */}
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
