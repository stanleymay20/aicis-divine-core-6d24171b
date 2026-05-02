import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Mode = "accept" | "dismiss";

interface QueueItem {
  id: string;
  country_iso3: string;
  domain: string;
  intervention_title: string;
  estimated_roi_eur: number | null;
}

interface Props {
  isPrivileged: boolean;
  visibleRows: QueueItem[];      // currently displayed top-10 proposed
  selectedIds: Set<string>;
  onClearSelection: () => void;
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

async function transition(input: {
  p_action_id: string;
  p_to_status: "accepted" | "dismissed";
  p_dismissal_reason?: string;
}) {
  const { error } = await supabase.rpc("transition_risk_action" as any, input);
  if (error) throw error;
}

export function PilotBulkActionBar({ isPrivileged, visibleRows, selectedIds, onClearSelection }: Props) {
  const qc = useQueryClient();
  const [confirmMode, setConfirmMode] = useState<null | { mode: Mode; targets: QueueItem[] }>(null);
  const [dismissReason, setDismissReason] = useState("");

  const summary = useMemo(() => {
    if (!confirmMode) return null;
    const t = confirmMode.targets;
    const totalRoi = t.reduce((s, r) => s + (r.estimated_roi_eur ?? 0), 0);
    const countries = Array.from(new Set(t.map((r) => r.country_iso3))).sort();
    const domains = Array.from(new Set(t.map((r) => r.domain))).sort();
    return { count: t.length, totalRoi, countries, domains };
  }, [confirmMode]);

  const bulk = useMutation({
    mutationFn: async () => {
      if (!confirmMode) return { ok: 0, fail: 0 };
      const reason = dismissReason.trim();
      if (confirmMode.mode === "dismiss" && reason.length < 3) {
        throw new Error("Dismissal reason is required (min 3 chars).");
      }
      let ok = 0, fail = 0;
      // Sequential: each call must hit transition_risk_action so audit log writes per row
      for (const row of confirmMode.targets) {
        try {
          await transition({
            p_action_id: row.id,
            p_to_status: confirmMode.mode === "accept" ? "accepted" : "dismissed",
            ...(confirmMode.mode === "dismiss" ? { p_dismissal_reason: reason } : {}),
          });
          ok++;
        } catch (e) {
          console.error("bulk transition failed for", row.id, e);
          fail++;
        }
      }
      return { ok, fail };
    },
    onSuccess: ({ ok, fail }) => {
      const verb = confirmMode?.mode === "accept" ? "accepted" : "dismissed";
      if (fail === 0) toast.success(`${ok} action${ok === 1 ? "" : "s"} ${verb}`);
      else toast.warning(`${ok} ${verb}, ${fail} failed`);
      qc.invalidateQueries({ queryKey: ["pilot-execution-queue"] });
      qc.invalidateQueries({ queryKey: ["pilot-weekly-metrics"] });
      qc.invalidateQueries({ queryKey: ["risk-action-lifecycle-metrics"] });
      qc.invalidateQueries({ queryKey: ["stale-proposed-actions"] });
      qc.invalidateQueries({ queryKey: ["pilot-truth-feed"] });
      setConfirmMode(null);
      setDismissReason("");
      onClearSelection();
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk action failed"),
  });

  if (!isPrivileged) return null;

  const top3 = visibleRows.slice(0, 3);
  const top5 = visibleRows.slice(0, 5);
  const selected = visibleRows.filter((r) => selectedIds.has(r.id));
  const hasSelection = selected.length > 0;

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
          disabled={top3.length === 0 || bulk.isPending}
          onClick={() => setConfirmMode({ mode: "accept", targets: top3 })}
        >
          <Zap className="h-3.5 w-3.5" /> Accept top 3
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          disabled={top5.length === 0 || bulk.isPending}
          onClick={() => setConfirmMode({ mode: "accept", targets: top5 })}
        >
          <Zap className="h-3.5 w-3.5" /> Accept top 5
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          size="sm"
          className="gap-1.5 h-8"
          disabled={!hasSelection || bulk.isPending}
          onClick={() => setConfirmMode({ mode: "accept", targets: selected })}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Accept selected ({selected.length})
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5 h-8"
          disabled={!hasSelection || bulk.isPending}
          onClick={() => setConfirmMode({ mode: "dismiss", targets: selected })}
        >
          <XCircle className="h-3.5 w-3.5" /> Dismiss selected ({selected.length})
        </Button>
        {hasSelection && (
          <Button size="sm" variant="ghost" className="h-8 ml-auto" onClick={onClearSelection}>
            Clear
          </Button>
        )}
      </div>

      <Dialog
        open={!!confirmMode}
        onOpenChange={(o) => {
          if (!o && !bulk.isPending) {
            setConfirmMode(null);
            setDismissReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmMode?.mode === "accept" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              Confirm bulk {confirmMode?.mode === "accept" ? "accept" : "dismiss"}
            </DialogTitle>
            <DialogDescription>
              Each action transitions individually through{" "}
              <span className="font-mono text-xs">transition_risk_action</span> — every row produces
              its own audit log entry.
            </DialogDescription>
          </DialogHeader>

          {summary && (
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

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={bulk.isPending}
              onClick={() => {
                setConfirmMode(null);
                setDismissReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => bulk.mutate()}
              disabled={bulk.isPending}
              variant={confirmMode?.mode === "dismiss" ? "destructive" : "default"}
              className="gap-2"
            >
              {bulk.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirm {confirmMode?.mode === "accept" ? "accept" : "dismiss"} ({summary?.count ?? 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Re-export checkbox primitive for convenience
export { Checkbox };
