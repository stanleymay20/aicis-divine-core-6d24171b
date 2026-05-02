import { useState, useMemo } from "react";
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
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, PlayCircle, Loader2, ClipboardCheck, AlertTriangle, HelpCircle } from "lucide-react";
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
type OutcomeChoice = "true" | "false" | "unknown";
type Confidence = "low" | "medium" | "high";
type SourceType = "operator" | "url" | "internal_report" | "third_party" | "official_source";

function OutcomeDialog({
  open, onOpenChange, actionId, title, estimatedRoiEur, iso3, domain, onDone,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  actionId: string; title: string; estimatedRoiEur: number | null;
  iso3: string; domain: string; onDone: () => void;
}) {
  const [success, setSuccess] = useState<OutcomeChoice>("true");
  const [confidence, setConfidence] = useState<Confidence>("medium");
  const [sourceType, setSourceType] = useState<SourceType>("operator");
  const [realized, setRealized] = useState<string>("");
  const [net, setNet] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  // Client-side checklist mirrors server scoring
  const checklist = useMemo(() => {
    const urlValid = /^https?:\/\//i.test(evidenceUrl.trim());
    const sourceSelected = sourceType !== "operator";
    const measuredKnown = realized.trim().length > 0 || net.trim().length > 0;
    const notesOk = notes.trim().length >= 30;
    let score = 0;
    if (urlValid) score += 0.30;
    if (sourceSelected) score += 0.20;
    if (measuredKnown) score += 0.20;
    if (notesOk) score += 0.20;
    if (confidence === "high") score += 0.10;
    else if (confidence === "medium") score += 0.05;
    if (score > 1) score = 1;
    return { urlValid, sourceSelected, measuredKnown, notesOk, score };
  }, [evidenceUrl, sourceType, realized, net, notes, confidence]);

  const isUnknown = success === "unknown";
  const hasNetValue = net.trim().length > 0;

  // Block submit when business rules fail
  const blockingError = useMemo(() => {
    if (evidenceUrl.trim().length > 0 && !checklist.urlValid)
      return "Evidence URL must start with http:// or https://";
    if (!isUnknown && !(checklist.urlValid || checklist.notesOk))
      return "When marking success/failure, provide either an evidence URL or notes (≥30 chars).";
    if (hasNetValue && !(checklist.urlValid || checklist.notesOk))
      return "When entering a net value, provide an evidence URL or measurement note (≥30 chars).";
    return null;
  }, [evidenceUrl, isUnknown, hasNetValue, checklist]);

  const willBeExcluded = isUnknown || checklist.score < 0.5;

  const mut = useMutation({
    mutationFn: async () => {
      if (blockingError) throw new Error(blockingError);

      const realizedNum = realized ? Number(realized) : null;
      const netNum = net ? Number(net) : null;
      if (realized && Number.isNaN(realizedNum!)) throw new Error("Realized value must be a number");
      if (net && Number.isNaN(netNum!)) throw new Error("Net value must be a number");

      const outcomeBool: boolean | null = isUnknown ? null : success === "true";

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
          outcome_success: outcomeBool,
          outcome_timestamp: new Date().toISOString(),
          outcome_source: "operator_logged",
          outcome_confidence: isUnknown ? "unknown" : confidence,
          measured_outcome: notes || null,
          evidence_note: notes || null,
          evidence_url: checklist.urlValid ? evidenceUrl.trim() : null,
          evidence_source_type: sourceType,
          evidence_type: realizedNum != null ? "measured" : (isUnknown ? "inconclusive" : "real"),
          roi_estimate: realizedNum,
          net_value: netNum,
          status: "outcome_logged",
        })
        .select("id, evidence_quality_score")
        .single();
      if (insErr) throw insErr;

      await transition({
        p_action_id: actionId,
        p_to_status: "outcome_logged",
        p_execution_note: notes || undefined,
        p_outcome_id: outcome!.id,
      });
      return outcome!;
    },
    onSuccess: (o: any) => {
      const score = Number(o?.evidence_quality_score ?? 0);
      if (isUnknown) {
        toast.success("Inconclusive outcome logged (excluded from learning).");
      } else if (score >= 0.5) {
        toast.success(`Outcome logged · evidence ${score >= 0.7 ? "strong" : "acceptable"} (${Math.round(score * 100)}%)`);
      } else {
        toast.warning(`Outcome logged but excluded from learning (evidence ${Math.round(score * 100)}%).`);
      }
      onDone();
      onOpenChange(false);
      setRealized(""); setNet(""); setNotes(""); setEvidenceUrl("");
      setSuccess("true"); setConfidence("medium"); setSourceType("operator");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to log outcome"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Log outcome</DialogTitle>
          <DialogDescription className="text-xs">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Outcome choice */}
          <div className="space-y-2">
            <Label className="text-xs">Outcome</Label>
            <RadioGroup
              value={success}
              onValueChange={(v) => setSuccess(v as OutcomeChoice)}
              className="grid grid-cols-3 gap-2"
            >
              <label htmlFor="o-yes" className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="true" id="o-yes" />
                <span className="text-xs flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Successful
                </span>
              </label>
              <label htmlFor="o-no" className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="false" id="o-no" />
                <span className="text-xs flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-destructive" /> Unsuccessful
                </span>
              </label>
              <label htmlFor="o-unk" className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="unknown" id="o-unk" />
                <span className="text-xs flex items-center gap-1">
                  <HelpCircle className="h-3 w-3 text-muted-foreground" /> Unknown
                </span>
              </label>
            </RadioGroup>
            {isUnknown && (
              <p className="text-[10px] text-muted-foreground">
                Inconclusive is allowed. ROI fields stay blank, and this outcome will not be used for learning.
              </p>
            )}
          </div>

          {/* Confidence + Source type */}
          {!isUnknown && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Outcome confidence</Label>
                <Select value={confidence} onValueChange={(v) => setConfidence(v as Confidence)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low — limited signal</SelectItem>
                    <SelectItem value="medium">Medium — corroborated</SelectItem>
                    <SelectItem value="high">High — directly measured</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Evidence source type</Label>
                <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operator">Operator-only (no external source)</SelectItem>
                    <SelectItem value="internal_report">Internal report</SelectItem>
                    <SelectItem value="third_party">Third-party</SelectItem>
                    <SelectItem value="official_source">Official source</SelectItem>
                    <SelectItem value="url">External URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Measured values */}
          {!isUnknown && (
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
                  placeholder="Leave blank if unknown" maxLength={20}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="net" className="text-xs">Net value (€)</Label>
                <Input
                  id="net" inputMode="decimal" value={net}
                  onChange={(e) => setNet(e.target.value)}
                  placeholder="Realized − cost" maxLength={20}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs">
              Notes {!isUnknown && <span className="text-muted-foreground">(≥30 chars or attach URL)</span>}
            </Label>
            <Textarea
              id="notes" value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              placeholder="What measurably happened? Reference the source." rows={3}
              maxLength={2000}
            />
            <div className="text-[10px] text-muted-foreground text-right">{notes.length}/2000</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev" className="text-xs">Evidence URL (https://…)</Label>
            <Input
              id="ev" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value.slice(0, 500))}
              placeholder="https://…" maxLength={500}
            />
          </div>

          {/* Live checklist + score */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Evidence checklist
              </span>
              <Badge
                variant="outline"
                className={
                  checklist.score >= 0.7
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px]"
                    : checklist.score >= 0.5
                      ? "border-amber-500/40 text-amber-700 dark:text-amber-400 text-[10px]"
                      : "border-destructive/40 text-destructive text-[10px]"
                }
              >
                quality {Math.round(checklist.score * 100)}%
              </Badge>
            </div>
            <ul className="space-y-1 text-[11px]">
              <CheckRow ok={checklist.urlValid} label="Evidence URL provided (https://…)" />
              <CheckRow ok={checklist.sourceSelected} label="Evidence source type selected (not operator-only)" />
              <CheckRow ok={checklist.measuredKnown} label="Measured value known (realized or net)" />
              <CheckRow ok={checklist.notesOk} label="Notes ≥ 30 characters" />
            </ul>
            {willBeExcluded && !blockingError && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  This outcome will be <span className="font-semibold">excluded from learning</span>{" "}
                  (quality &lt; 50%{isUnknown ? " or inconclusive" : ""}). It remains visible in the truth feed.
                </span>
              </div>
            )}
            {blockingError && (
              <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{blockingError}</span>
              </div>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Only enter values you can substantiate. Blank fields stay NULL — no fabrication. Server re-validates every rule.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">Cancel</Button>
          <Button
            className="text-xs gap-1"
            disabled={mut.isPending || !!blockingError}
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

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : (
        <XCircle className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
