import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

export const FeedbackSummaryPanel = () => {
  const { data: feedback, isLoading } = useQuery({
    queryKey: ["learning-feedback-summary"],
    queryFn: async () => {
      const { data } = await supabase
        .from("signal_feedback")
        .select("feedback_type, rating, category, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!data) return { total: 0, confirmed: 0, rejected: 0, unclear: 0, avgRating: 0, recent: [] };

      const confirmed = data.filter((f) => f.feedback_type === "confirmed").length;
      const rejected = data.filter((f) => f.feedback_type === "rejected").length;
      const unclear = data.filter((f) => f.feedback_type === "unclear").length;
      const ratings = data.filter((f) => f.rating != null).map((f) => f.rating!);
      const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

      return { total: data.length, confirmed, rejected, unclear, avgRating, recent: data.slice(0, 5) };
    },
  });

  const ICONS = { confirmed: CheckCircle2, rejected: XCircle, unclear: HelpCircle };
  const COLORS = { confirmed: "text-emerald-500", rejected: "text-red-500", unclear: "text-amber-500" };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          Operator Feedback
          {feedback && feedback.total > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-auto">{feedback.total} entries</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : feedback && feedback.total === 0 ? (
          <div className="py-6 text-center">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">No operator feedback yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Rate signals from the Live Feed to build routing precision
            </p>
          </div>
        ) : feedback ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(["confirmed", "rejected", "unclear"] as const).map((type) => {
                const Icon = ICONS[type];
                const count = feedback[type];
                const pct = feedback.total > 0 ? (count / feedback.total * 100).toFixed(0) : "0";
                return (
                  <div key={type} className="text-center p-2 rounded-lg border border-border/50">
                    <Icon className={`h-4 w-4 mx-auto mb-1 ${COLORS[type]}`} />
                    <p className="text-lg font-bold text-foreground">{count}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{type} ({pct}%)</p>
                  </div>
                );
              })}
            </div>
            {feedback.avgRating > 0 && (
              <div className="text-center py-2 border-t border-border/30">
                <p className="text-[10px] text-muted-foreground">Average Rating</p>
                <p className="text-lg font-bold text-primary">{feedback.avgRating.toFixed(1)} / 5</p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
