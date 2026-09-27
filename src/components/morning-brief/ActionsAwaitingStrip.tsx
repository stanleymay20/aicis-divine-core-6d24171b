import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  ChevronRight,
  Clock,
  Flame,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { getCountryFlagFromIso3 } from "@/lib/geo/country-flags";
import { cn } from "@/lib/utils";

type DecisionOutcomeRow =
  Database["public"]["Tables"]["decision_outcome_log"]["Row"];

type PendingAction = Pick<
  DecisionOutcomeRow,
  | "id"
  | "decision_id"
  | "signal_id"
  | "signal_title"
  | "domain"
  | "iso3"
  | "impact_score"
  | "recommended_action"
  | "execution_status"
  | "execution_blocker"
  | "created_at"
  | "review_sla_hours"
  | "review_due_at"
  | "review_status"
  | "evidence_type"
  | "evidence_source_type"
  | "evidence_quality_score"
  | "signal_confidence"
>;

const cleanSignalTitle = (title: string) =>
  title.replace(/^\s*\[[A-Z0-9_-]+\]\s*/i, "").trim();

const isPast = (value: string | null) =>
  value ? new Date(value).getTime() < Date.now() : false;

const ageDays = (createdAt: string | null) => {
  if (!createdAt) return 0;
  return (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
};

const severityOf = (
  score: number | null,
): { label: string; className: string } => {
  const value = score ?? 0;
  if (value >= 80) {
    return {
      label: "CRITICAL",
      className:
        "border-destructive/30 bg-destructive/20 text-destructive",
    };
  }
  if (value >= 60) {
    return {
      label: "HIGH",
      className: "border-amber-500/30 bg-amber-500/20 text-amber-500",
    };
  }
  if (value >= 40) {
    return {
      label: "MED",
      className:
        "border-yellow-500/25 bg-yellow-500/15 text-yellow-600",
    };
  }
  return {
    label: "LOW",
    className: "border-border bg-muted text-muted-foreground",
  };
};

export function ActionsAwaitingStrip() {
  const navigate = useNavigate();
  const { selectEntity } = useIntelligenceOS();

  const { data: actions = [], isLoading } = useQuery<PendingAction[]>({
    queryKey: ["actions-awaiting"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decision_outcome_log")
        .select(
          "id, decision_id, signal_id, signal_title, domain, iso3, impact_score, recommended_action, execution_status, execution_blocker, created_at, review_sla_hours, review_due_at, review_status, evidence_type, evidence_source_type, evidence_quality_score, signal_confidence",
        )
        .in("execution_status", ["not_started", "overdue", "in_progress"])
        .order("impact_score", { ascending: false, nullsFirst: false })
        .limit(60);

      if (error) throw error;

      const seen = new Set<string>();
      const unique: PendingAction[] = [];

      for (const row of data ?? []) {
        const title = cleanSignalTitle(row.signal_title);
        const key = [
          title.toLowerCase(),
          row.domain ?? "",
          row.iso3 ?? "",
        ].join("|");

        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ ...row, signal_title: title });

        if (unique.length >= 12) break;
      }

      return unique;
    },
    staleTime: 30_000,
  });

  const isOverdue = (action: PendingAction) => {
    if (action.execution_status === "overdue") return true;
    if (isPast(action.review_due_at)) return true;
    if (!action.review_sla_hours || !action.created_at) return false;

    const created = new Date(action.created_at).getTime();
    return Date.now() - created > action.review_sla_hours * 3_600_000;
  };

  const inspectDecision = (action: PendingAction) => {
    const id = action.decision_id || action.id;

    selectEntity({
      id,
      type: "decision",
      name: action.signal_title,
      description:
        action.recommended_action ||
        "Decision/follow-up item awaiting governed review.",
      observedAt: action.created_at ?? undefined,
      geography: action.iso3
        ? {
            country: action.iso3,
          }
        : undefined,
      metadata: {
        signalId: action.signal_id,
        domain: action.domain,
        impactScore: action.impact_score,
        executionStatus: action.execution_status,
        reviewStatus: action.review_status,
        evidenceType: action.evidence_type,
        evidenceSourceType: action.evidence_source_type,
        evidenceQualityScore: action.evidence_quality_score,
        signalConfidence: action.signal_confidence,
        executionBlocker: action.execution_blocker,
      },
    });
  };

  const openDecision = (action: PendingAction) => {
    const id = action.decision_id || action.id;
    const params = new URLSearchParams({
      entity: `decision:${id}`,
    });
    navigate(`/decision-ops?${params.toString()}`);
  };

  if (isLoading || actions.length === 0) return null;

  const fresh = actions.filter(
    (action) => ageDays(action.created_at) <= 7 && (action.impact_score ?? 0) >= 40,
  );
  const lowerPriority = actions.filter(
    (action) => ageDays(action.created_at) <= 7 && (action.impact_score ?? 0) < 40,
  );
  const stale = actions.filter((action) => ageDays(action.created_at) > 7);
  const overdueCount = fresh.filter(isOverdue).length;

  const renderRow = (
    action: PendingAction,
    options?: { muted?: boolean },
  ) => {
    const overdue = isOverdue(action);
    const severity = severityOf(action.impact_score);
    const flag = getCountryFlagFromIso3(action.iso3);

    return (
      <div
        key={action.id}
        className={cn(
          "flex items-start gap-2 rounded-lg border p-2.5 transition-all",
          overdue
            ? "border-destructive/30 bg-destructive/5"
            : options?.muted
              ? "border-border/40 bg-muted/20 opacity-80"
              : "border-border/50 hover:border-primary/30 hover:bg-primary/5",
        )}
      >
        <Badge
          variant="outline"
          className={cn(
            "mt-0.5 h-5 shrink-0 px-1.5 font-mono text-[9px]",
            severity.className,
          )}
        >
          {severity.label}
        </Badge>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-base leading-none" aria-hidden>
              {flag}
            </span>
            <p className="truncate text-xs font-medium">{action.signal_title}</p>
          </div>

          {action.recommended_action && (
            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/90">
              <span className="text-muted-foreground/70">Proposed action: </span>
              {action.recommended_action}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
              {action.domain || "—"}
            </Badge>

            <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
              {action.execution_status || "unknown"}
            </Badge>

            {action.created_at && (
              <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {formatDistanceToNow(new Date(action.created_at), {
                  addSuffix: true,
                })}
              </span>
            )}

            {overdue && (
              <Badge
                variant="destructive"
                className="h-4 text-[9px]"
              >
                REVIEW OVERDUE
              </Badge>
            )}
          </div>

          {action.execution_blocker && (
            <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>Blocker: {action.execution_blocker}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[10px]"
            onClick={() => inspectDecision(action)}
          >
            <BrainCircuit className="h-3 w-3" />
            Inspect
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-[10px]"
            onClick={() => openDecision(action)}
          >
            Decisions
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card
      className={
        overdueCount > 0
          ? "border-destructive/40 bg-destructive/5"
          : "border-primary/30 bg-primary/5"
      }
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Flame className="h-4 w-4 shrink-0 text-destructive" />
            <span className="truncate text-sm font-semibold">
              Decisions Requiring Attention
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs"
            onClick={() => navigate("/decision-ops")}
          >
            Open Decisions
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>

        <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <ShieldCheck className="h-3 w-3 text-primary" />
            Brief is read-only.
          </span>{" "}
          Review context here; execution, completion, dismissal, and governed
          approvals happen in the Decisions workspace.
        </div>

        {fresh.length > 0 && (
          <div className="space-y-2">
            {fresh.slice(0, 6).map((action) => renderRow(action))}
          </div>
        )}

        {lowerPriority.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              <span>
                Lower-priority queue · {lowerPriority.length} item
                {lowerPriority.length === 1 ? "" : "s"}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {lowerPriority
                .slice(0, 4)
                .map((action) => renderRow(action, { muted: true }))}
            </div>
          </details>
        )}

        {stale.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              <span>
                Stale backlog · {stale.length} item
                {stale.length === 1 ? "" : "s"} older than 7 days
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {stale
                .slice(0, 4)
                .map((action) => renderRow(action, { muted: true }))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
