import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  RadioTower,
  ShieldCheck,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import type { Database as DB } from "@/integrations/supabase/types";

type SignalRow = DB["public"]["Tables"]["global_signals"]["Row"];
type PriorityBase = Pick<
  SignalRow,
  | "id"
  | "title"
  | "summary"
  | "category"
  | "impact_score"
  | "urgency_score"
  | "confidence_score"
  | "affected_sectors"
  | "affected_regions"
  | "affected_countries"
  | "strategic_implications"
  | "recommended_actions"
  | "first_detected_at"
  | "latest_update_at"
  | "source_trust_tier"
  | "source_count"
  | "primary_source"
  | "impact_reasoning"
  | "uncertainty_notes"
  | "likely_consequences"
  | "official_source"
  | "multi_source_confirmed"
>;

type Urgency = "critical" | "high" | "medium";

type PrioritySignal = PriorityBase & {
  urgency: Urgency;
  proposedAction: string | null;
  reviewWindow: string;
};

const urgencyFromScore = (impact: number, urgency: number): Urgency => {
  const combined = impact * 0.6 + urgency * 0.4;
  if (combined >= 80) return "critical";
  if (combined >= 60) return "high";
  return "medium";
};

const deriveReviewWindow = (urgency: Urgency): string => {
  if (urgency === "critical") return "today";
  if (urgency === "high") return "within 48 hours";
  return "this week";
};

const extractProposedAction = (value: PriorityBase["recommended_actions"]): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  for (const key of ["business", "government", "general"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return null;
};

const URGENCY_BORDER: Record<Urgency, string> = {
  critical: "border-l-destructive",
  high: "border-l-amber-500",
  medium: "border-l-primary",
};

const URGENCY_BG: Record<Urgency, string> = {
  critical: "bg-destructive/5",
  high: "bg-amber-500/5",
  medium: "bg-card",
};

const scoreText = (value: number | null | undefined) =>
  value == null ? "Unknown" : `${Math.round(value)}/100`;

const RECENT_WINDOW_DAYS = 14;

type PriorityResult = { signals: PrioritySignal[]; stale: boolean };

const formatObserved = (value: string | null | undefined) => {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  const stamp = date.toISOString().slice(0, 10);
  if (days <= 0) return `${stamp} · today`;
  return `${stamp} · ${days}d old`;
};

export function PriorityDecisionsPanel() {
  const navigate = useNavigate();
  const { selectEntity } = useIntelligenceOS();

  const { data, isLoading } = useQuery<PriorityResult>({
    queryKey: ["priority-decisions"],
    queryFn: async () => {
      const columns =
        "id, title, summary, category, impact_score, urgency_score, confidence_score, affected_sectors, affected_regions, affected_countries, strategic_implications, recommended_actions, first_detected_at, latest_update_at, source_trust_tier, source_count, primary_source, impact_reasoning, uncertainty_notes, likely_consequences, official_source, multi_source_confirmed";

      const decorate = (rows: PriorityBase[]): PrioritySignal[] =>
        rows.map((signal) => {
          const urgency = urgencyFromScore(signal.impact_score, signal.urgency_score);
          return {
            ...signal,
            urgency,
            proposedAction: extractProposedAction(signal.recommended_actions),
            reviewWindow: deriveReviewWindow(urgency),
          };
        });

      const windowStart = new Date(
        Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const recent = await supabase
        .from("global_signals")
        .select(columns)
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 60)
        .gte("first_detected_at", windowStart)
        .order("impact_score", { ascending: false })
        .order("urgency_score", { ascending: false })
        .limit(5);

      if (recent.error) throw recent.error;

      if ((recent.data ?? []).length > 0) {
        return { signals: decorate(recent.data as PriorityBase[]), stale: false };
      }

      const fallback = await supabase
        .from("global_signals")
        .select(columns)
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 60)
        .order("first_detected_at", { ascending: false })
        .order("impact_score", { ascending: false })
        .limit(5);

      if (fallback.error) throw fallback.error;

      return { signals: decorate((fallback.data ?? []) as PriorityBase[]), stale: true };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const priorities = data?.signals ?? [];
  const isStale = data?.stale ?? false;
  const newestAgeDays = priorities.length
    ? Math.floor(
        (Date.now() - new Date(priorities[0].first_detected_at).getTime()) /
          (24 * 60 * 60 * 1000),
      )
    : 0;

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

  if (isLoading) {
    return (
      <Card className="border-primary/30">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Priority Signals</span>
          </div>
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-40 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (priorities.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">No high-impact enriched signals</p>
              <p className="text-xs text-muted-foreground">
                AICIS is not inventing a priority item when the governed signal query returns none.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate("/live")} className="shrink-0 gap-1">
              View Signals <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <RadioTower className="h-4 w-4 shrink-0 text-primary" />
          <h2 className="truncate text-sm font-bold">Priority Signals</h2>
          <Badge variant="destructive" className="text-[10px]">
            {priorities.filter((signal) => signal.urgency === "critical").length} critical
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 text-xs text-primary"
          onClick={() => navigate("/live")}
        >
          All signals <ArrowRight className="h-3 w-3" />
        </Button>
      </div>

      {isStale && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 p-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                No high-impact signals in the last {RECENT_WINDOW_DAYS} days.
              </span>{" "}
              Showing the most recent ones on record — the newest is {newestAgeDays} days
              old. Newer incoming signals have not been scored yet, so they cannot appear
              here.
            </p>
          </CardContent>
        </Card>
      )}



      {priorities.map((signal) => (
        <Card
          key={signal.id}
          className={cn(
            "border-l-4 transition-all hover:shadow-md",
            URGENCY_BORDER[signal.urgency],
            URGENCY_BG[signal.urgency],
          )}
        >
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4 shrink-0",
                      signal.urgency === "critical"
                        ? "text-destructive"
                        : signal.urgency === "high"
                          ? "text-amber-500"
                          : "text-primary",
                    )}
                  />
                  <Badge
                    variant={signal.urgency === "critical" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {signal.urgency === "critical"
                      ? "Critical"
                      : signal.urgency === "high"
                        ? "High"
                        : "Moderate"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {signal.category}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="gap-1 font-mono text-[9px] text-muted-foreground"
                  >
                    <Clock className="h-3 w-3" />
                    {formatObserved(signal.first_detected_at)}
                  </Badge>
                  {signal.affected_countries?.slice(0, 2).map((country) => (
                    <Badge key={country} variant="outline" className="h-5 text-[9px]">
                      {country}
                    </Badge>
                  ))}
                </div>

                <h3 className="text-sm font-bold leading-snug">{signal.title}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {signal.strategic_implications || signal.summary}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Impact" value={scoreText(signal.impact_score)} />
              <Metric label="Urgency" value={scoreText(signal.urgency_score)} />
              <Metric label="Confidence" value={scoreText(signal.confidence_score)} />
              <Metric label="Sources" value={String(signal.source_count)} />
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="mb-1 flex items-center gap-2">
                <Target className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Proposed action
                </span>
              </div>
              {signal.proposedAction ? (
                <>
                  <p className="text-sm font-medium leading-snug">{signal.proposedAction}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Review {signal.reviewWindow}; this is not recorded as executed from the brief.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No governed action proposal is attached to this signal.
                </p>
              )}
            </div>

            <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
              <EvidenceLine
                label="Source trust"
                value={signal.source_trust_tier || "Unknown"}
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
              />
              <EvidenceLine
                label="Primary source"
                value={signal.primary_source || "Unavailable"}
                icon={<Database className="h-3.5 w-3.5" />}
              />
            </div>

            {signal.impact_reasoning && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Impact reasoning: </span>
                {signal.impact_reasoning}
              </p>
            )}

            {signal.uncertainty_notes && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Uncertainty: </span>
                {signal.uncertainty_notes}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => inspectSignal(signal)}
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                Inspect signal
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() => openInDecisions(signal)}
              >
                Open in Decisions
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-muted/50 p-2 text-center">
    <p className="text-xs font-bold font-mono tabular-nums text-foreground">{value}</p>
    <p className="text-[9px] text-muted-foreground">{label}</p>
  </div>
);

const EvidenceLine = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div className="flex items-start gap-2 rounded-md border border-border/60 p-2">
    <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
    <span className="min-w-0">
      <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="block truncate text-[11px] text-foreground">{value}</span>
    </span>
  </div>
);
