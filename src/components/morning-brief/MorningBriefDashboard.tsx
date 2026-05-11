import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ChevronDown, ChevronUp, Radio, Activity, TrendingUp, Layers,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRoles } from "@/hooks/useUserRoles";
import { PriorityDecisionsPanel } from "./PriorityDecisionsPanel";
import { SystemHealthBadge } from "./SystemHealthBadge";
import { SignalDrillDown } from "@/components/command-center/SignalDrillDown";
import { useNavigate } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BusinessExposureStrip } from "./BusinessExposureStrip";
import { ActionsAwaitingStrip } from "./ActionsAwaitingStrip";
import { ExecutiveProofPanel } from "./ExecutiveProofPanel";
import { RecentDecisionsWidget } from "./RecentDecisionsWidget";
import { WatchlistBriefWidget } from "@/components/watchlist/WatchlistBriefWidget";
import { SystemStatusStrip } from "./SystemStatusStrip";
import { DomainMixStrip } from "./DomainMixStrip";
import { LayerTrustTiersPanel } from "./LayerTrustTiersPanel";
import { PersistentAskBar } from "./PersistentAskBar";
import { TopEmergingRisksPanel } from "@/components/risk-ranking/TopEmergingRisksPanel";
import { PlanetaryDetectionBadge } from "./PlanetaryDetectionBadge";

export const MorningBriefDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isOperator } = useUserRoles();
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

  const cleanName = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const base = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
    const stripped = base.replace(/[._\-+]+/g, " ").replace(/\d+$/g, "").trim();
    const first = stripped.split(/\s+/)[0] || base;
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  };

  const firstName = cleanName(profile?.full_name) || cleanName(user?.email) || "Operator";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  const detailLabel = isAdmin
    ? "View operator and system details"
    : isOperator
    ? "View operator details"
    : "View more context";

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in">
      <PersistentAskBar />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            className="text-xl sm:text-3xl font-light leading-[1.1] tracking-tight truncate"
            title={user?.email || ""}
          >
            {greeting}, <span className="font-semibold text-primary">{firstName}</span>.
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Your command brief: what changed, what matters, and what needs action.
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground font-mono tabular-nums">
            {format(new Date(), "EEE, MMM d · HH:mm")} UTC
          </p>
        </div>
        <SystemHealthBadge />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Situation</h2>
          <p className="text-xs text-muted-foreground">Current exposure, watchlist pressure, and fresh intelligence indicators.</p>
        </div>
        <BusinessExposureStrip />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action Queue</h2>
          <p className="text-xs text-muted-foreground">Items requiring review, decision, or follow-up.</p>
        </div>
        <ActionsAwaitingStrip />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority Decisions</h2>
          <p className="text-xs text-muted-foreground">Highest-impact risks translated into recommended action.</p>
        </div>
        <PriorityDecisionsPanel />
      </section>

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
                Hide additional context
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                {detailLabel}
              </>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-5 pt-3">
          <section className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market & Watchlist Context</h2>
            </div>
            <TopEmergingRisksPanel />
            <WatchlistBriefWidget />
            <RecentDecisionsWidget />
          </section>

          {isOperator && (
            <section className="space-y-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operator Context</h2>
                <p className="text-xs text-muted-foreground">Deeper signal, domain, and trust context for analysts.</p>
              </div>
              <PlanetaryDetectionBadge />
              <DomainMixStrip />
              <LayerTrustTiersPanel />
              <ExecutiveProofPanel />
            </section>
          )}

          {isAdmin && (
            <section className="space-y-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System Context</h2>
                <p className="text-xs text-muted-foreground">Admin-only health and data-quality signals.</p>
              </div>
              <SystemStatusStrip />
            </section>
          )}

          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">Next Actions</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ActionCard
                  icon={<Radio className="h-4 w-4 text-primary" />}
                  title="Review Signals"
                  desc="See routed risks and fresh intelligence"
                  onClick={() => navigate("/live")}
                />
                <ActionCard
                  icon={<Activity className="h-4 w-4 text-primary" />}
                  title="Execute Decisions"
                  desc="Act on open decisions and outcomes"
                  onClick={() => navigate("/decision-ops")}
                />
                <ActionCard
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  title="Check Watchlist"
                  desc="Review countries, sectors, or routes you track"
                  onClick={() => navigate("/watchlist")}
                />
                <ActionCard
                  icon={<Layers className="h-4 w-4 text-primary" />}
                  title="Open Atlas"
                  desc="Explore country and regional exposure"
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
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
  </button>
);
