import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, Target, Clock, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Signal {
  id: string;
  title: string;
  category: string;
  impact_score: number;
  confidence_score: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: Signal | null;
  recommendedAction: string;
  onSuccess?: () => void;
}

function estimateImpact(score: number): string {
  if (score >= 80) return "€1M+";
  if (score >= 70) return "€500K+";
  if (score >= 60) return "€200K+";
  return "€50K+";
}

export function ExecuteActionDialog({ open, onOpenChange, signal, recommendedAction, onSuccess }: Props) {
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!signal) throw new Error("No signal");
      const { error } = await supabase.from("decision_outcome_log").insert({
        signal_id: signal.id,
        signal_title: `[SIGNAL] ${signal.title}`,
        signal_date: new Date().toISOString().slice(0, 10),
        domain: signal.category,
        recommended_action: recommendedAction,
        action_taken: true,
        impact_score: signal.impact_score,
        evidence_type: "hypothetical",
        execution_owner: owner || null,
        execution_note: notes || null,
        execution_status: "not_started",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Action created", description: "Added to your execution queue. Track outcomes to prove value." });
      queryClient.invalidateQueries({ queryKey: ["morning-brief-decisions"] });
      queryClient.invalidateQueries({ queryKey: ["executive-proof"] });
      queryClient.invalidateQueries({ queryKey: ["priority-decisions"] });
      queryClient.invalidateQueries({ queryKey: ["business-exposure-strip"] });
      setOwner("");
      setDueDate("");
      setNotes("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e: any) => {
      toast({ title: "Failed to create action", description: e.message, variant: "destructive" });
    },
  });

  if (!signal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Execute Action
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action summary */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
            <Badge variant="outline" className="text-[10px]">Recommended action</Badge>
            <p className="text-sm font-semibold">{recommendedAction}</p>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {estimateImpact(signal.impact_score)} potential exposure
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Impact score: {signal.impact_score}
              </span>
            </div>
          </div>

          {/* Assignment */}
          <div className="space-y-2">
            <Label htmlFor="owner" className="text-xs">Assign to (optional)</Label>
            <Input
              id="owner"
              placeholder="Team member or team name"
              value={owner}
              onChange={e => setOwner(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Due date */}
          <div className="space-y-2">
            <Label htmlFor="due" className="text-xs">Due date (optional)</Label>
            <Input
              id="due"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-xs">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add context or instructions..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="gap-2 text-xs"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Confirm & Execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
