import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  signalId: string;
  category?: string;
  sourceTier?: string;
  compact?: boolean;
}

export const SignalFeedbackButton = ({ signalId, category, sourceTier, compact = false }: Props) => {
  const [submitted, setSubmitted] = useState<string | null>(null);
  const qc = useQueryClient();

  const submitFeedback = useMutation({
    mutationFn: async (feedbackType: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("signal_feedback").insert({
        user_id: user.id,
        signal_id: signalId,
        feedback_type: feedbackType,
        category: category || null,
        source_tier: sourceTier || null,
      });
      if (error) throw error;
    },
    onSuccess: (_, feedbackType) => {
      setSubmitted(feedbackType);
      qc.invalidateQueries({ queryKey: ["learning-feedback-summary"] });
      toast.success("Feedback recorded");
    },
  });

  if (submitted) {
    const Icon = submitted === "confirmed" ? CheckCircle2 : submitted === "rejected" ? XCircle : HelpCircle;
    const color = submitted === "confirmed" ? "text-emerald-500" : submitted === "rejected" ? "text-red-500" : "text-amber-500";
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] ${color}`}>
        <Icon className="h-3 w-3" />
        {submitted}
      </span>
    );
  }

  const btnClass = compact ? "h-6 w-6 p-0" : "h-7 px-2 text-[10px] gap-1";

  return (
    <div className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(btnClass, "text-muted-foreground hover:text-emerald-500")}
        onClick={() => submitFeedback.mutate("confirmed")}
        title="Confirm signal accuracy"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(btnClass, "text-muted-foreground hover:text-red-500")}
        onClick={() => submitFeedback.mutate("rejected")}
        title="Reject signal"
      >
        <XCircle className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(btnClass, "text-muted-foreground hover:text-amber-500")}
        onClick={() => submitFeedback.mutate("unclear")}
        title="Mark as unclear"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
