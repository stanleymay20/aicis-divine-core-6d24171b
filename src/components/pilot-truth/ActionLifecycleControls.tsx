import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, XCircle, PlayCircle, Loader2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

type Status = "proposed" | "accepted" | "dismissed" | "executed" | "outcome_logged" | "expired";

interface Props {
  actionId: string;
  status: Status;
  interventionTitle: string;
  estimatedRoiEur: number | null;
  iso3: string;
  domain: string;
  isPrivileged: boolean;
}

async function transition(input: {
  p_action_id: string;
  p_to_status: "accepted" | "dismissed" | "executed" | "outcome_logged";
  p_dismissal_reason?: string;
  p_execution_note?: string;
  p_outcome_id?: string;
}) {
  const { data, error } = await supabase.rpc("transition_risk_action" as any, input);
  if (error) throw error;
  return data;
}

export function ActionLifecycleControls({
  actionId, status, interventionTitle, estimatedRoiEur, iso3, domain, isPrivileged,
}: Props) {
  const qc = useQueryClient();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pilot-truth-feed"] });
    qc.invalidateQueries({ queryKey: ["stale-proposed-actions"] });
    qc.invalidateQueries({ queryKey: ["pilot-truth-summary"] });
    qc.invalidateQueries({ queryKey: ["risk-action-lifecycle-metrics"] });
  };

  const acceptMut = useMutation({
    mutationFn: () => transition({ p_action_id: actionId, p_to_status: "accepted" }),
    onSuccess: () => { toast.success("Action accepted"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "Failed to accept"),
  });

  if (!isPrivileged) {
    return (
      <span className="text-[10px] text-muted-foreground italic">
        Admin/operator role required to act
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "proposed" && (
        <>
          <Button
            size="sm" variant="default" className="h-7 text-[11px] gap-1"
            onClick={() => acceptMut.mutate()}
            disabled={acceptMut.isPending}
          >
            {acceptMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Accept
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-[11px] gap-1"
            onClick={() => setDismissOpen(true)}
          >
            <XCircle className="h-3 w-3" /> Dismiss
          </Button>
        </>
      )}
      {status === "accepted" && (
        <Button
          size="sm" variant="default" className="h-7 text-[11px] gap-1"
          onClick={() => setExecuteOpen(true)}
        >
          <PlayCircle className="h-3 w-3" /> Mark Executed
        </Button>
      )}
      {status === "executed" && (
        <Button
          size="sm" variant="default" className="h-7 text-[11px] gap-1"
          onClick={() => setOutcomeOpen(true)}
        >
          <ClipboardCheck className="h-3 w-3" /> Log Outcome
        </Button>
      )}
      {status === "outcome_logged" && (
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
          ✓ Outcome logged
        </span>
      )}
      {status === "dismissed" && (
        <span className="text-[10px] text-muted-foreground">Dismissed</span>
      )}
      {status === "expired" && (
        <span className="text-[10px] text-amber-600">Expired</span>
      )}

      <DismissDialog
        open={dismissOpen} onOpenChange={setDismissOpen}
        actionId={actionId} title={interventionTitle} onDone={invalidate}
      />
      <ExecuteDialog
        open={executeOpen} onOpenChange={setExecuteOpen}
        actionId={actionId} title={interventionTitle} onDone={invalidate}
      />
      <OutcomeDialog
        open={outcomeOpen} onOpenChange={setOutcomeOpen}
        actionId={actionId} title={interventionTitle}
        estimatedRoiEur={estimatedRoiEur} iso3={iso3} domain={domain}
        onDone={invalidate}
      />
    </div>
  );
}

/* ---------- Dismiss dialog ---------- */
function DismissDialog({
  open, onOpenChange, actionId, title, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; actionId: string; title: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      transition({ p_action_id: actionId, p_to_status: "dismissed", p_dismissal_reason: reason || undefined }),
    onSuccess: () => { toast.success("Action dismissed"); onDone(); onOpenChange(false); setReason(""); },
    onError: (e: any) => toast.error(e.message ?? "Failed to dismiss"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Dismiss action</DialogTitle>
          <DialogDescription className="text-xs">{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason" className="text-xs">Reason (required for audit trail)</Label>
          <Textarea
            id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this action being dismissed?" rows={3}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button
            variant="destructive" className="text-xs gap-1"
            disabled={mut.isPending || reason.trim().length < 3}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Execute dialog ---------- */
function ExecuteDialog({
  open, onOpenChange, actionId, title, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; actionId: string; title: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      transition({ p_action_id: actionId, p_to_status: "executed", p_execution_note: note || undefined }),
    onSuccess: () => { toast.success("Marked executed"); onDone(); onOpenChange(false); setNote(""); },
    onError: (e: any) => toast.error(e.message ?? "Failed to mark executed"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Mark executed</DialogTitle>
          <DialogDescription className="text-xs">{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="note" className="text-xs">Execution note (optional)</Label>
          <Textarea
            id="note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What was done, by whom, when?" rows={3}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button
            className="text-xs gap-1"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
            Confirm execution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Outcome dialog ---------- */
function OutcomeDialog({
  open, onOpenChange, actionId, title, estimatedRoiEur, iso3, domain, onDone,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  actionId: string; title: string; estimatedRoiEur: number | null;
  iso3: string; domain: string; onDone: () => void;
}) {
  const [success, setSuccess] = useState<"true" | "false">("true");
  const [realized, setRealized] = useState<string>("");
  const [net, setNet] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const realizedNum = realized ? Number(realized) : null;
      const netNum = net ? Number(net) : null;
      if (realized && Number.isNaN(realizedNum!)) throw new Error("Realized value must be a number");
      if (net && Number.isNaN(netNum!)) throw new Error("Net value must be a number");

      // 1. Insert decision_outcome_log row (real evidence, no fabrication)
      const { data: outcome, error: insErr } = await supabase
        .from("decision_outcome_log")
        .insert({
          signal_id: `risk_action:${actionId}`,
          signal_title: title,
          signal_date: new Date().toISOString().slice(0, 10),
          iso3,
          domain,
          recommended_action: title,
          action_taken: true,
          outcome_success: success === "true",
          outcome_timestamp: new Date().toISOString(),
          outcome_source: "operator_logged",
          measured_outcome: notes || null,
          evidence_note: evidenceUrl ? `evidence_url=${evidenceUrl}` : null,
          evidence_source_type: evidenceUrl ? "url" : "operator",
          evidence_type: realizedNum != null ? "measured" : "real",
          roi_estimate: realizedNum,
          net_value: netNum,
          status: "outcome_logged",
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      // 2. Transition action with linked outcome id (audit-logged)
      await transition({
        p_action_id: actionId,
        p_to_status: "outcome_logged",
        p_execution_note: notes || undefined,
        p_outcome_id: outcome!.id,
      });
    },
    onSuccess: () => {
      toast.success("Outcome logged & action closed");
      onDone();
      onOpenChange(false);
      setRealized(""); setNet(""); setNotes(""); setEvidenceUrl(""); setSuccess("true");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to log outcome"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Log outcome</DialogTitle>
          <DialogDescription className="text-xs">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Outcome</Label>
            <RadioGroup value={success} onValueChange={(v) => setSuccess(v as "true" | "false")} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="true" id="o-yes" />
                <Label htmlFor="o-yes" className="text-xs flex items-center gap-1 cursor-pointer">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Successful
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="false" id="o-no" />
                <Label htmlFor="o-no" className="text-xs flex items-center gap-1 cursor-pointer">
                  <XCircle className="h-3 w-3 text-destructive" /> Unsuccessful
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="realized" className="text-xs">
                Realized value (€){" "}
                {estimatedRoiEur != null && (
                  <span className="text-muted-foreground">
                    · est. {new Intl.NumberFormat("en-EU").format(estimatedRoiEur)}
                  </span>
                )}
              </Label>
              <Input
                id="realized" inputMode="decimal" value={realized}
                onChange={(e) => setRealized(e.target.value)}
                placeholder="Leave blank if unknown"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="net" className="text-xs">Net value (€)</Label>
              <Input
                id="net" inputMode="decimal" value={net}
                onChange={(e) => setNet(e.target.value)}
                placeholder="Realized − cost"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs">Notes</Label>
            <Textarea
              id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="What measurably happened?" rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev" className="text-xs">Evidence URL (optional)</Label>
            <Input
              id="ev" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Only enter values you can substantiate. Blank fields stay NULL — no fabrication.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button
            className="text-xs gap-1"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardCheck className="h-3 w-3" />}
            Log outcome
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
