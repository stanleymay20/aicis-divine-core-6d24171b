import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionId: string | null;
  actionTitle?: string;
}

export function CompleteActionDialog({ open, onOpenChange, actionId, actionTitle }: Props) {
  const [success, setSuccess] = useState<string>("true");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!actionId) throw new Error("No action");
      const { error } = await supabase.functions.invoke("record-decision-outcome", {
        body: {
          decision_id: actionId,
          outcome_success: success === "true",
          outcome_description: notes || undefined,
          action_taken: true,
          execution_status: "completed",
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Outcome recorded — value tracked");
      queryClient.invalidateQueries({ queryKey: ["actions-awaiting"] });
      queryClient.invalidateQueries({ queryKey: ["execution-counts"] });
      queryClient.invalidateQueries({ queryKey: ["execution-command-records"] });
      queryClient.invalidateQueries({ queryKey: ["executive-proof"] });
      queryClient.invalidateQueries({ queryKey: ["business-exposure-strip"] });
      setNotes("");
      setSuccess("true");
      onOpenChange(false);
    },
    onError: () => toast.error("Failed to record outcome"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Record Outcome
          </DialogTitle>
        </DialogHeader>

        {actionTitle && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
            {actionTitle}
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Was this action successful?</Label>
            <RadioGroup value={success} onValueChange={setSuccess} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="true" id="success-yes" />
                <Label htmlFor="success-yes" className="text-xs flex items-center gap-1 cursor-pointer">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Yes
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="false" id="success-no" />
                <Label htmlFor="success-no" className="text-xs flex items-center gap-1 cursor-pointer">
                  <XCircle className="h-3 w-3 text-destructive" /> No
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="outcome-notes" className="text-xs">What happened? (optional)</Label>
            <Textarea
              id="outcome-notes"
              placeholder="Describe the result, impact, or lessons learned..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
            Record Outcome
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
