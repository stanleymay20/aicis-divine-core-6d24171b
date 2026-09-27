import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Layers,
  Radio,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRoles } from "@/hooks/useUserRoles";
import { PriorityDecisionsPanel } from "./PriorityDecisionsPanel";
import { SystemHealthBadge } from "./SystemHealthBadge";
import { useNavigate } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

const formatUtcStamp = (date: Date) => {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} · ${iso.slice(11, 16)} UTC`;
};

export const MorningBriefDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isOperator } = useUserRoles();
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

  const firstName =
    cleanName(profile?.full_name) || cleanName(user?.email) || "Operator";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

  const detailLabel = isAdmin
    ? "View operator and system details"
    : isOperator
      ? "View operator details"
      : "View more context";

  return (
    <div className="animate-fade-in space-y-4 sm:space-y-5">
      <PersistentAskBar />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            className="truncate text-xl font-light leading-[1.1] tracking-tight sm:text-3xl"
            title={user?.email || ""}
          >
            {greeting},{" "}
            <span className="font-semibold text-primary">{firstName}</span>.
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Your intelligence brief: what changed, why it matters, and what needs attention.
          </p>
          <p className="font-mono text-[10px] tabular-nums text-muted-foreground sm:text-xs">
            {formatUtcStamp(new Date())}
          </p>
        </div>
        <SystemHealthBadge />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What changed
          </h2>
          <p className="text-xs text-muted-foreground">
            Measured signal, decision, and vulnerability counts from the current data.
          </p>
        </div>
        <BusinessExposureStrip />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Why it matters
          </h2>
          <p className="text-xs text-muted-foreground">
            Highest-impact signals with stored evidence, uncertainty, and proposed actions.
          </p>
        </div>
        <PriorityDecisionsPanel />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What needs attention
          </h2>
          <p className="text-xs text-muted-foreground">
            Existing decision and follow-up items requiring review.
          </p>
        </div>
        <ActionsAwaitingStrip />
      </section>

      <Collapsible open={showMore} onOpenChange={setShowMore}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-muted-foreground hover:text-foreground"
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
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Watchlist & lower-priority context
              </h2>
            </div>
            <TopEmergingRisksPanel />
            <WatchlistBriefWidget />
            <RecentDecisionsWidget />
          </section>

          {isOperator && (
            <section className="space-y-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Operator Context
                </h2>
                <p className="text-xs text-muted-foreground">
                  Deeper signal, domain, and trust context for analysts.
                </p>
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
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  System Context
                </h2>
                <p className="text-xs text-muted-foreground">
                  Admin-only health and data-quality signals.
                </p>
              </div>
              <SystemStatusStrip />
            </section>
          )}

          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Continue investigation</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ActionCard
                  icon={<Radio className="h-4 w-4 text-primary" />}
                  title="Review Signals"
                  desc="See routed risks and fresh intelligence"
                  onClick={() => navigate("/live")}
                />
                <ActionCard
                  icon={<Activity className="h-4 w-4 text-primary" />}
                  title="Open Decisions"
                  desc="Review open decisions and outcomes"
                  onClick={() => navigate("/decision-ops")}
                />
                <ActionCard
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  title="Opportunity Radar"
                  desc="Review opportunity research"
                  onClick={() => navigate("/opportunities")}
                />
                <ActionCard
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  title="Check Watchlist"
                  desc="Review countries, sectors, or routes you track"
                  onClick={() => navigate("/watchlist")}
                />
                <ActionCard
                  icon={<Layers className="h-4 w-4 text-primary" />}
                  title="Open World"
                  desc="Explore geographic exposure and evidence"
                  onClick={() => navigate("/world?layer=vulnerability")}
                />
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

const ActionCard = ({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="group flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-all hover:border-primary/30 hover:bg-primary/5"
  >
    <div className="shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium transition-colors group-hover:text-primary">
        {title}
      </p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
  </button>
);
