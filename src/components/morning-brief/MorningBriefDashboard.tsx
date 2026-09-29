import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
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
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { ForecastMovementPanel } from "./ForecastMovementPanel";
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
import {
  formatSignalAge,
  usePrioritySignals,
  type PrioritySignal,
} from "./usePrioritySignals";
import { cn } from "@/lib/utils";

const formatUtcStamp = (date: Date) => {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} · ${iso.slice(11, 16)} UTC`;
};

const scoreText = (value: number | null | undefined) =>
  value == null ? "Unknown" : `${Math.round(value)}/100`;

export const MorningBriefDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isOperator } = useUserRoles();
  const { selectEntity } = useIntelligenceOS();
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

  const { data: priorityData, isLoading: prioritiesLoading } =
    usePrioritySignals(5);
  const priorities = priorityData?.signals ?? [];
  const prioritiesStale = priorityData?.stale ?? false;
  const [featured, ...secondarySignals] = priorities;

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

  const inspectSignal = (signal: PrioritySignal) => {
    selectEntity({
      id: signal.id,
      type: "signal",
      name: signal.title,
      description: signal.summary || signal.strategic_implications || undefined,
      confidence: signal.confidence_score,
      sourceCount: signal.source_count,
      observedAt: signal.first_detected_at,
      updatedAt: signal.latest_update_at,
      geography:
        signal.affected_countries?.length === 1
          ? { country: signal.affected_countries[0] }
          : undefined,
      provenance: signal.primary_source
        ? [
            {
              id: `signal-source:${signal.id}`,
              label: signal.primary_source,
              sourceType: signal.source_trust_tier || "signal source",
              observedAt: signal.first_detected_at,
            },
          ]
        : undefined,
      metadata: {
        category: signal.category,
        impactScore: signal.impact_score,
        urgencyScore: signal.urgency_score,
        sourceTrustTier: signal.source_trust_tier,
        officialSource: signal.official_source,
        multiSourceConfirmed: signal.multi_source_confirmed,
        affectedCountries: signal.affected_countries?.join(", ") || null,
      },
    });
  };

  const openInDecisions = (signal: PrioritySignal) => {
    const params = new URLSearchParams({ entity: `signal:${signal.id}` });
    navigate(`/decision-ops?${params.toString()}`);
  };

  return (
    <div className="animate-fade-in space-y-6">
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
          <p className="font-mono text-[10px] tabular-nums text-muted-foreground sm:text-xs">
            {formatUtcStamp(new Date())}
          </p>
        </div>
        <SystemHealthBadge />
      </div>

      {prioritiesStale && priorities.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          No high-impact signals in the last 14 days. Showing the most recent
          ones on record — newer incoming signals have not been scored yet, so
          they cannot appear here.
        </div>
      )}

      {/* Featured story */}
      {prioritiesLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : featured ? (
        <section className="relative">
          <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-primary/20 to-transparent opacity-75 blur" />
          <div className="relative flex flex-col gap-8 rounded-lg border border-border bg-card p-6 md:flex-row md:p-8">
            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                  Top Priority
                </span>
                <Badge
                  variant={
                    featured.urgency === "critical" ? "destructive" : "secondary"
                  }
                  className="text-[10px]"
                >
                  {featured.urgency === "critical"
                    ? "Critical"
                    : featured.urgency === "high"
                      ? "High"
                      : "Moderate"}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatSignalAge(featured.first_detected_at)}
                </span>
              </div>
              <h2 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
                {featured.title}
              </h2>
              <p className="max-w-2xl leading-relaxed text-muted-foreground">
                {featured.strategic_implications || featured.summary}
              </p>
              <div className="flex flex-wrap gap-6 pt-2">
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Impact
                  </p>
                  <p className="font-semibold text-primary">
                    {scoreText(featured.impact_score)}
                  </p>
                </div>
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Confidence
                  </p>
                  <p className="font-semibold text-foreground">
                    {scoreText(featured.confidence_score)}
                  </p>
                </div>
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Sources
                  </p>
                  <p className="font-semibold text-foreground">
                    {featured.source_count}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => inspectSignal(featured)}
                >
                  <BrainCircuit className="h-3.5 w-3.5" />
                  Inspect signal
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => openInDecisions(featured)}
                >
                  Open in Decisions
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-3 rounded border border-border bg-muted/30 p-5 md:w-64">
              <h3 className="text-xs font-bold uppercase tracking-widest text-foreground">
                Why it matters
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {featured.impact_reasoning ||
                  featured.likely_consequences ||
                  featured.summary ||
                  "No stored reasoning for this signal yet."}
              </p>
              {featured.proposedAction && (
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Proposed action:{" "}
                  </span>
                  {featured.proposedAction}{" "}
                  <span className="text-muted-foreground/70">
                    (review {featured.reviewWindow}; not recorded as executed
                    from the brief)
                  </span>
                </p>
              )}
            </div>
          </div>
        </section>
      ) : (
        <Card className="border-primary/20">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">No high-impact enriched signals</p>
              <p className="text-xs text-muted-foreground">
                AICIS is not inventing a priority item when the governed signal
                query returns none.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/live")}
              className="shrink-0 gap-1"
            >
              View Signals <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Secondary grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {secondarySignals.slice(0, 2).map((signal) => (
          <button
            key={signal.id}
            onClick={() => inspectSignal(signal)}
            className="space-y-3 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary/30"
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {signal.category}
              </span>
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  signal.urgency === "critical"
                    ? "bg-destructive"
                    : signal.urgency === "high"
                      ? "bg-amber-500"
                      : "bg-primary",
                )}
              />
            </div>
            <h3 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
              {signal.title}
            </h3>
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {signal.summary}
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatSignalAge(signal.first_detected_at)}
              </span>
              <span className="font-mono text-xs text-primary">
                {scoreText(signal.impact_score)}
              </span>
            </div>
          </button>
        ))}
        <ActionsAwaitingStrip />
      </div>

      <ForecastMovementPanel />

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
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What changed
            </h2>
            <BusinessExposureStrip />
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Watchlist & lower-priority context
            </h2>
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
