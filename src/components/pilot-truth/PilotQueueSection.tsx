import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket, AlertTriangle, CheckCircle2, PlayCircle, ClipboardCheck, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ActionLifecycleControls } from "@/components/pilot-truth/ActionLifecycleControls";
import { PilotBulkActionBar } from "@/components/pilot-truth/PilotBulkActionBar";

type QueueRow = {
  id: string;
  country_iso3: string;
  domain: string;
  intervention_type: string;
  intervention_title: string;
  rationale_md: string | null;
  confidence: number;
  estimated_roi_eur: number | null;
  urgency_window: string;
  urgency_hours: number;
  status: "proposed" | "accepted" | "executed";
  created_at: string;
  accepted_at: string | null;
  executed_at: string | null;
  outcome_logged_at: string | null;
  learning_multiplier: number;
  intervention_quality_score: number | null;
  adjusted_priority_score: number;
  pilot_priority_score: number;
  queue_stage: "rank_for_execution" | "awaiting_execution" | "awaiting_outcome";
  outcome_needed: boolean;
  stage_age_days: number;
};

type WeeklyMetrics = {
  accepted_this_week: number;
  executed_this_week: number;
  outcomes_logged_this_week: number;
  outcome_needed_count: number;
  proposed_open_count: number;
  accepted_open_count: number;
  executed_open_count: number;
};

const fmtEur = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function PilotQueueSection({ isPrivileged }: { isPrivileged: boolean }) {
  const queue = useQuery({
    queryKey: ["pilot-execution-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_execution_queue" as any)
        .select("*")
        .order("pilot_priority_score", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as QueueRow[];
    },
  });

  const metrics = useQuery({
    queryKey: ["pilot-weekly-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_weekly_metrics" as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as WeeklyMetrics;
    },
  });

  const rows = queue.data ?? [];
  const top10Proposed = useMemo(
    () => rows.filter((r) => r.queue_stage === "rank_for_execution").slice(0, 10),
    [rows]
  );
  const awaitingExecution = rows.filter((r) => r.queue_stage === "awaiting_execution");
  const awaitingOutcome = rows.filter((r) => r.queue_stage === "awaiting_outcome");
  const outcomeNeeded = rows.filter((r) => r.outcome_needed);

  // Selection state — only proposed rows in the top-10 are selectable
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectableIds = useMemo(() => new Set(top10Proposed.map((r) => r.id)), [top10Proposed]);
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = top10Proposed.length > 0 && top10Proposed.every((r) => selectedIds.has(r.id));
  const toggleAll = () =>
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  const clearSelection = () => setSelectedIds(new Set());

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4 text-primary" />
          Pilot Execution Queue
        </CardTitle>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Curated execution surface. Top 10 proposed actions are ranked by{" "}
          <span className="font-mono">pilot_priority_score</span> (50% adjusted confidence + 30% ROI
          + 20% urgency). Accept or dismiss to start generating real learning data.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Weekly metrics strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricTile
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="Accepted (7d)"
            value={metrics.data?.accepted_this_week ?? "…"}
          />
          <MetricTile
            icon={<PlayCircle className="h-3.5 w-3.5" />}
            label="Executed (7d)"
            value={metrics.data?.executed_this_week ?? "…"}
          />
          <MetricTile
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            label="Outcomes (7d)"
            value={metrics.data?.outcomes_logged_this_week ?? "…"}
          />
          <MetricTile
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Outcome needed"
            value={metrics.data?.outcome_needed_count ?? "…"}
            tone={metrics.data && metrics.data.outcome_needed_count > 0 ? "warn" : "default"}
          />
        </div>

        {/* Outcome-needed reminder strip */}
        {outcomeNeeded.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {outcomeNeeded.length} action{outcomeNeeded.length === 1 ? "" : "s"} need outcome (7+ days old)
            </div>
            <div className="space-y-1.5">
              {outcomeNeeded.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant="outline" className="font-mono text-[10px]">{r.country_iso3}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{r.domain}</Badge>
                    <span className="truncate">{r.intervention_title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground">
                      {Math.floor(r.stage_age_days)}d since {r.executed_at ? "execution" : "accept"}
                    </span>
                    <ActionLifecycleControls
                      actionId={r.id}
                      status={r.status}
                      interventionTitle={r.intervention_title}
                      estimatedRoiEur={r.estimated_roi_eur ?? 0}
                      iso3={r.country_iso3}
                      domain={r.domain}
                      isPrivileged={isPrivileged}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top 10 proposed for execution */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Rocket className="h-3 w-3" /> Top 10 ranked for execution
            </div>
            {isPrivileged && top10Proposed.length > 0 && (
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all top 10"
                />
                <span className="text-muted-foreground">Select all ({selectedIds.size}/{top10Proposed.length})</span>
              </label>
            )}
          </div>

          {/* Bulk action bar */}
          {top10Proposed.length > 0 && (
            <PilotBulkActionBar
              isPrivileged={isPrivileged}
              visibleRows={top10Proposed.map((r) => ({
                id: r.id,
                country_iso3: r.country_iso3,
                domain: r.domain,
                intervention_title: r.intervention_title,
                estimated_roi_eur: r.estimated_roi_eur,
              }))}
              selectedIds={selectedIds}
              onClearSelection={clearSelection}
            />
          )}

          {queue.isLoading && <Skeleton className="h-48 w-full" />}

          {!queue.isLoading && top10Proposed.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg bg-muted/20">
              No proposed actions in queue. Run the recommendation generator to populate.
            </div>
          )}

          <div className="space-y-2">
            {top10Proposed.map((r, i) => (
              <PilotRow
                key={r.id}
                row={r}
                rank={i + 1}
                isPrivileged={isPrivileged}
                selected={selectedIds.has(r.id)}
                onToggle={() => toggleOne(r.id)}
              />
            ))}
          </div>
        </div>

        {/* Awaiting execution */}
        {awaitingExecution.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Clock className="h-3 w-3" /> Awaiting execution ({awaitingExecution.length})
            </div>
            <div className="space-y-1.5">
              {awaitingExecution.slice(0, 10).map((r) => (
                <CompactRow key={r.id} row={r} isPrivileged={isPrivileged} />
              ))}
            </div>
          </div>
        )}

        {/* Awaiting outcome */}
        {awaitingOutcome.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <ClipboardCheck className="h-3 w-3" /> Awaiting outcome ({awaitingOutcome.length})
            </div>
            <div className="space-y-1.5">
              {awaitingOutcome.slice(0, 10).map((r) => (
                <CompactRow key={r.id} row={r} isPrivileged={isPrivileged} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PilotRow({
  row,
  rank,
  isPrivileged,
  selected,
  onToggle,
}: {
  row: QueueRow;
  rank: number;
  isPrivileged: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const isBoosted = row.learning_multiplier > 1.05;
  const isReduced = row.learning_multiplier < 0.95;
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${selected ? "bg-primary/5 border-primary/40" : "bg-card/50"}`}>
      <div className="flex items-start gap-3">
        {isPrivileged && (
          <div className="pt-1 shrink-0">
            <Checkbox
              checked={selected}
              onCheckedChange={onToggle}
              aria-label={`Select action for ${row.country_iso3} ${row.domain}`}
            />
          </div>
        )}
        <div className="text-lg font-bold tabular-nums text-muted-foreground w-6 shrink-0">
          {rank}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="font-mono text-[10px]">{row.country_iso3}</Badge>
            <Badge variant="secondary" className="text-[10px]">{row.domain}</Badge>
            <Badge variant="outline" className="text-[10px]">{row.urgency_window}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">
              conf {(row.confidence * 100).toFixed(0)}%
            </Badge>
            {(isBoosted || isReduced) && (
              <Badge
                variant="outline"
                className={`text-[10px] font-mono ${
                  isBoosted
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                    : "bg-destructive/10 text-destructive border-destructive/30"
                }`}
              >
                {row.learning_multiplier.toFixed(2)}× learned
              </Badge>
            )}
          </div>
          <div className="text-sm font-medium">{row.intervention_title}</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>est. ROI <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtEur(row.estimated_roi_eur)}</span></span>
            <span>· priority <span className="font-mono">{(row.pilot_priority_score * 100).toFixed(0)}</span></span>
          </div>
        </div>
        <div className="shrink-0">
          <ActionLifecycleControls
            actionId={row.id}
            status={row.status}
            interventionTitle={row.intervention_title}
            estimatedRoiEur={row.estimated_roi_eur ?? 0}
            iso3={row.country_iso3}
            domain={row.domain}
            isPrivileged={isPrivileged}
          />
        </div>
      </div>
    </div>
  );
}

function CompactRow({ row, isPrivileged }: { row: QueueRow; isPrivileged: boolean }) {
  const anchor = row.executed_at ?? row.accepted_at ?? row.created_at;
  return (
    <div className="flex items-center justify-between gap-3 p-2 rounded border bg-card/30 text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Badge variant="outline" className="font-mono text-[10px]">{row.country_iso3}</Badge>
        <Badge variant="secondary" className="text-[10px]">{row.domain}</Badge>
        <span className="truncate">{row.intervention_title}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(anchor), { addSuffix: true })}
        </span>
        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
          {fmtEur(row.estimated_roi_eur)}
        </span>
        <ActionLifecycleControls
          actionId={row.id}
          status={row.status}
          interventionTitle={row.intervention_title}
          estimatedRoiEur={row.estimated_roi_eur ?? 0}
          iso3={row.country_iso3}
          domain={row.domain}
          isPrivileged={isPrivileged}
        />
      </div>
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "default" | "warn";
}) {
  const toneClass =
    tone === "warn" ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-card";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}
