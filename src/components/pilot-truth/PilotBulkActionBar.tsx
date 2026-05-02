import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Zap, Loader2, AlertTriangle, RotateCcw, FlaskConical, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Mode = "accept" | "dismiss";
type CohortKind = "pilot_run" | "scaled" | "free";

interface QueueItem {
  id: string;
  country_iso3: string;
  domain: string;
  intervention_title: string;
  estimated_roi_eur: number | null;
}

interface Props {
  isPrivileged: boolean;
  visibleRows: QueueItem[];
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

interface FailedItem {
  item: QueueItem;
  error: string;
}

interface RunState {
  phase: "idle" | "checking" | "running" | "done";
  index: number;
  total: number;
  currentTitle: string;
  okCount: number;
  failCount: number;
  skippedCount: number;
  skipped: QueueItem[];
  failed: FailedItem[];
  succeeded: QueueItem[];
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const initialRun: RunState = {
  phase: "idle",
  index: 0,
  total: 0,
  currentTitle: "",
  okCount: 0,
  failCount: 0,
  skippedCount: 0,
  skipped: [],
  failed: [],
  succeeded: [],
};

async function transition(input: {
  p_action_id: string;
  p_to_status: "accepted" | "dismissed";
  p_dismissal_reason?: string;
}) {
  const { error } = await supabase.rpc("transition_risk_action" as any, input);
  if (error) throw error;
}

/** Fetch current statuses for the targets and split into still-proposed vs drifted. */
async function refetchStatuses(items: QueueItem[]): Promise<{ live: QueueItem[]; drifted: QueueItem[] }> {
  if (items.length === 0) return { live: [], drifted: [] };
  const ids = items.map((i) => i.id);
  const { data, error } = await supabase
    .from("risk_action_recommendations" as any)
    .select("id,status")
    .in("id", ids);
  if (error) throw error;
  const statusById = new Map<string, string>();
  (data ?? []).forEach((r: any) => statusById.set(r.id, r.status));
  const live: QueueItem[] = [];
  const drifted: QueueItem[] = [];
  for (const it of items) {
    const s = statusById.get(it.id);
    if (s === "proposed") live.push(it);
    else drifted.push(it);
  }
  return { live, drifted };
}

export function PilotBulkActionBar({ isPrivileged, visibleRows, selectedIds, onClearSelection }: Props) {
  const qc = useQueryClient();
  const [confirmMode, setConfirmMode] = useState<
    null | { mode: Mode; targets: QueueItem[]; cohortKind: CohortKind }
  >(null);
  const [dismissReason, setDismissReason] = useState("");
  const [pilotNotes, setPilotNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [run, setRun] = useState<RunState>(initialRun);
  const [pilotRunId, setPilotRunId] = useState<string | null>(null);

  // Active pilot run (controls scaling guard messaging)
  const activeRun = useQuery({
    queryKey: ["controlled-pilot-runs-active"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("controlled_pilot_run_status" as any)
        .select("pilot_run_id,status,outcomes_logged_count,cohort_size")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Is current user admin (gates override option)
  const isAdmin = useQuery({
    queryKey: ["is-admin-check"],
    enabled: isPrivileged,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "admin")
        .limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },
  });

  const summary = useMemo(() => {
    if (!confirmMode) return null;
    const t = confirmMode.targets;
    const totalRoi = t.reduce((s, r) => s + (r.estimated_roi_eur ?? 0), 0);
    const countries = Array.from(new Set(t.map((r) => r.country_iso3))).sort();
    const domains = Array.from(new Set(t.map((r) => r.domain))).sort();
    return { count: t.length, totalRoi, countries, domains };
  }, [confirmMode]);

  const postSummary = useMemo(() => {
    if (run.phase !== "done") return null;
    const affected = [...run.succeeded];
    const totalRoi = affected.reduce((s, r) => s + (r.estimated_roi_eur ?? 0), 0);
    const countries = Array.from(new Set(affected.map((r) => r.country_iso3))).sort();
    const domains = Array.from(new Set(affected.map((r) => r.domain))).sort();
    return { totalRoi, countries, domains };
  }, [run]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["pilot-execution-queue"] });
    qc.invalidateQueries({ queryKey: ["pilot-weekly-metrics"] });
    qc.invalidateQueries({ queryKey: ["risk-action-lifecycle-metrics"] });
    qc.invalidateQueries({ queryKey: ["stale-proposed-actions"] });
    qc.invalidateQueries({ queryKey: ["pilot-truth-feed"] });
    qc.invalidateQueries({ queryKey: ["controlled-pilot-runs"] });
    qc.invalidateQueries({ queryKey: ["controlled-pilot-runs-active"] });
    qc.invalidateQueries({ queryKey: ["pilot-scaling-overrides"] });
  }

  /** Core executor: drift-check then sequential RPC with live progress. */
  async function execute(targets: QueueItem[], mode: Mode, reason: string) {
    if (mode === "dismiss" && reason.trim().length < 3) {
      toast.error("Dismissal reason is required (min 3 chars).");
      return;
    }

    // Phase 1: drift re-check
    setRun({
      ...initialRun,
      phase: "checking",
      total: targets.length,
      currentTitle: "Re-checking action statuses…",
    });

    let live: QueueItem[] = [];
    let drifted: QueueItem[] = [];
    try {
      const r = await refetchStatuses(targets);
      live = r.live;
      drifted = r.drifted;
    } catch (e: any) {
      toast.error(`Drift check failed: ${e?.message ?? e}`);
      setRun(initialRun);
      return;
    }

    if (live.length === 0) {
      setRun({
        ...initialRun,
        phase: "done",
        total: targets.length,
        skippedCount: drifted.length,
        skipped: drifted,
      });
      invalidateAll();
      toast.warning(`All ${drifted.length} actions drifted out of "proposed" — nothing to do.`);
      return;
    }

    // Phase 2: sequential transitions
    const succeeded: QueueItem[] = [];
    const failed: FailedItem[] = [];
    setRun({
      phase: "running",
      index: 0,
      total: live.length,
      currentTitle: live[0]?.intervention_title ?? "",
      okCount: 0,
      failCount: 0,
      skippedCount: drifted.length,
      skipped: drifted,
      succeeded: [],
      failed: [],
    });

    for (let i = 0; i < live.length; i++) {
      const row = live[i];
      setRun((prev) => ({
        ...prev,
        index: i + 1,
        currentTitle: row.intervention_title,
      }));
      try {
        await transition({
          p_action_id: row.id,
          p_to_status: mode === "accept" ? "accepted" : "dismissed",
          ...(mode === "dismiss" ? { p_dismissal_reason: reason.trim() } : {}),
        });
        succeeded.push(row);
        setRun((prev) => ({ ...prev, okCount: prev.okCount + 1, succeeded: [...prev.succeeded, row] }));
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.error("bulk transition failed for", row.id, e);
        failed.push({ item: row, error: msg });
        setRun((prev) => ({
          ...prev,
          failCount: prev.failCount + 1,
          failed: [...prev.failed, { item: row, error: msg }],
        }));
      }
    }

    setRun((prev) => ({ ...prev, phase: "done" }));
    invalidateAll();

    const verb = mode === "accept" ? "accepted" : "dismissed";
    if (failed.length === 0 && drifted.length === 0) {
      toast.success(`${succeeded.length} action${succeeded.length === 1 ? "" : "s"} ${verb}`);
    } else {
      toast.warning(
        `${succeeded.length} ${verb}, ${failed.length} failed, ${drifted.length} skipped (drifted)`
      );
    }
  }

  function handleConfirm() {
    if (!confirmMode) return;
    void execute(confirmMode.targets, confirmMode.mode, dismissReason);
  }

  function handleRetryFailed() {
    if (!confirmMode || run.failed.length === 0) return;
    const retryTargets = run.failed.map((f) => f.item);
    void execute(retryTargets, confirmMode.mode, dismissReason);
  }

  function handleClose() {
    if (run.phase === "running" || run.phase === "checking") return;
    setConfirmMode(null);
    setDismissReason("");
    setRun(initialRun);
    onClearSelection();
  }

  if (!isPrivileged) return null;

  const top3 = visibleRows.slice(0, 3);
  const top5 = visibleRows.slice(0, 5);
  const selected = visibleRows.filter((r) => selectedIds.has(r.id));
  const hasSelection = selected.length > 0;
  const isBusy = run.phase === "running" || run.phase === "checking";

  const progressPct =
    run.total > 0 && (run.phase === "running" || run.phase === "done")
      ? Math.round((run.index / run.total) * 100)
      : 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/40 p-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
          Bulk:
        </span>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          disabled={top3.length === 0 || isBusy}
          onClick={() => { setRun(initialRun); setConfirmMode({ mode: "accept", targets: top3 }); }}
        >
          <Zap className="h-3.5 w-3.5" /> Accept top 3
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          disabled={top5.length === 0 || isBusy}
          onClick={() => { setRun(initialRun); setConfirmMode({ mode: "accept", targets: top5 }); }}
        >
          <Zap className="h-3.5 w-3.5" /> Accept top 5
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          size="sm"
          className="gap-1.5 h-8"
          disabled={!hasSelection || isBusy}
          onClick={() => { setRun(initialRun); setConfirmMode({ mode: "accept", targets: selected }); }}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Accept selected ({selected.length})
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5 h-8"
          disabled={!hasSelection || isBusy}
          onClick={() => { setRun(initialRun); setConfirmMode({ mode: "dismiss", targets: selected }); }}
        >
          <XCircle className="h-3.5 w-3.5" /> Dismiss selected ({selected.length})
        </Button>
        {hasSelection && (
          <Button size="sm" variant="ghost" className="h-8 ml-auto" onClick={onClearSelection} disabled={isBusy}>
            Clear
          </Button>
        )}
      </div>

      <Dialog
        open={!!confirmMode}
        onOpenChange={(o) => { if (!o) handleClose(); }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmMode?.mode === "accept" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              {run.phase === "done"
                ? `Bulk ${confirmMode?.mode === "accept" ? "accept" : "dismiss"} complete`
                : `Confirm bulk ${confirmMode?.mode === "accept" ? "accept" : "dismiss"}`}
            </DialogTitle>
            <DialogDescription>
              Each action transitions individually through{" "}
              <span className="font-mono text-xs">transition_risk_action</span> — every row produces
              its own audit log entry. Statuses are re-checked just before execution.
            </DialogDescription>
          </DialogHeader>

          {/* IDLE / CONFIRM PHASE */}
          {run.phase === "idle" && summary && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Actions</div>
                  <div className="text-2xl font-bold tabular-nums">{summary.count}</div>
                </div>
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total est. ROI</div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmtEur(summary.totalRoi)}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Countries ({summary.countries.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {summary.countries.slice(0, 20).map((c) => (
                    <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>
                  ))}
                  {summary.countries.length > 20 && (
                    <Badge variant="outline" className="text-[10px]">+{summary.countries.length - 20}</Badge>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Domains ({summary.domains.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {summary.domains.map((d) => (
                    <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
                  ))}
                </div>
              </div>

              {confirmMode?.mode === "dismiss" && (
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-dismiss-reason" className="text-xs">
                    Dismissal reason (applied to all) <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="bulk-dismiss-reason"
                    value={dismissReason}
                    onChange={(e) => setDismissReason(e.target.value)}
                    placeholder="e.g. Already covered by ongoing program; not actionable; out of scope…"
                    rows={3}
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          )}

          {/* RUNNING / CHECKING PHASE */}
          {(run.phase === "running" || run.phase === "checking") && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">
                    {run.phase === "checking" ? "Re-checking statuses…" : `Processing ${run.index} / ${run.total}`}
                  </span>
                  <span className="font-mono text-muted-foreground">{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="h-2" />
              </div>
              <div className="rounded border bg-muted/30 p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Current</div>
                <div className="text-sm truncate flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span className="truncate">{run.currentTitle || "—"}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ProgressTile label="Success" value={run.okCount} tone="ok" />
                <ProgressTile label="Failed" value={run.failCount} tone={run.failCount > 0 ? "fail" : "default"} />
                <ProgressTile label="Skipped" value={run.skippedCount} tone={run.skippedCount > 0 ? "warn" : "default"} />
              </div>
            </div>
          )}

          {/* DONE PHASE — post-action summary */}
          {run.phase === "done" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <ProgressTile
                  label={confirmMode?.mode === "accept" ? "Accepted" : "Dismissed"}
                  value={run.okCount}
                  tone="ok"
                />
                <ProgressTile label="Failed" value={run.failCount} tone={run.failCount > 0 ? "fail" : "default"} />
                <ProgressTile label="Skipped" value={run.skippedCount} tone={run.skippedCount > 0 ? "warn" : "default"} />
              </div>

              {postSummary && run.okCount > 0 && (
                <div className="rounded border bg-muted/30 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total est. ROI affected</div>
                    <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmtEur(postSummary.totalRoi)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Countries ({postSummary.countries.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {postSummary.countries.slice(0, 20).map((c) => (
                        <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>
                      ))}
                      {postSummary.countries.length > 20 && (
                        <Badge variant="outline" className="text-[10px]">+{postSummary.countries.length - 20}</Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Domains ({postSummary.domains.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {postSummary.domains.map((d) => (
                        <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Skipped (drifted) */}
              {run.skipped.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Skipped — no longer in “proposed” ({run.skipped.length})
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {run.skipped.slice(0, 20).map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-[11px]">
                        <Badge variant="outline" className="font-mono text-[9px]">{s.country_iso3}</Badge>
                        <span className="truncate">{s.intervention_title}</span>
                      </div>
                    ))}
                    {run.skipped.length > 20 && (
                      <div className="text-[10px] text-muted-foreground">+{run.skipped.length - 20} more</div>
                    )}
                  </div>
                </div>
              )}

              {/* Failed */}
              {run.failed.length > 0 && (
                <div className="rounded border border-destructive/40 bg-destructive/5 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    Failed ({run.failed.length})
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {run.failed.map((f) => (
                      <div key={f.item.id} className="text-[11px] space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[9px]">{f.item.country_iso3}</Badge>
                          <span className="truncate font-medium">{f.item.intervention_title}</span>
                        </div>
                        <div className="text-destructive/80 font-mono text-[10px] pl-1 truncate" title={f.error}>
                          {f.error}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {run.phase === "idle" && (
              <>
                <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                <Button
                  onClick={handleConfirm}
                  variant={confirmMode?.mode === "dismiss" ? "destructive" : "default"}
                  className="gap-2"
                >
                  Confirm {confirmMode?.mode === "accept" ? "accept" : "dismiss"} ({summary?.count ?? 0})
                </Button>
              </>
            )}
            {(run.phase === "running" || run.phase === "checking") && (
              <Button disabled className="gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Working… ({run.index}/{run.total})
              </Button>
            )}
            {run.phase === "done" && (
              <>
                {run.failed.length > 0 && (
                  <Button variant="outline" onClick={handleRetryFailed} className="gap-2">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry failed ({run.failed.length})
                  </Button>
                )}
                <Button onClick={handleClose}>Done</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProgressTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "fail" | "warn" | "default";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
      : tone === "fail"
        ? "border-destructive/40 bg-destructive/5 text-destructive"
        : tone === "warn"
          ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
          : "border-border bg-card";
  return (
    <div className={`rounded border p-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export { Checkbox };
