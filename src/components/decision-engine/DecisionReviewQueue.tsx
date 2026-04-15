import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp, Shield } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

interface ReviewItem {
  id: string;
  signal_summary: string;
  domain: string;
  severity_score: number;
  confidence: number | null;
  review_notes: string | null;
  country_iso3: string | null;
  created_at: string;
  reasoning_md: string | null;
}

export default function DecisionReviewQueue() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<ReviewItem[]>({
    queryKey: ["decision-review-queue"],
    queryFn: async () => {
      const { data } = await supabase
        .from("adi_decisions")
        .select("id, signal_summary, domain, severity_score, confidence, review_notes, country_iso3, created_at, reasoning_md")
        .eq("status", "needs_review")
        .order("severity_score", { ascending: false })
        .limit(50);
      return (data as any) || [];
    },
    staleTime: 30_000,
  });

  const reviewAction = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const updates = action === "approve"
        ? { status: "approved", approved_at: new Date().toISOString(), review_notes: "Human-approved" }
        : { status: "rejected", review_notes: "Human-rejected" };
      const { error } = await supabase.from("adi_decisions").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ["decision-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["execution-command-records"] });
      queryClient.invalidateQueries({ queryKey: ["outcome-backlog-burner"] });
      toast.success(action === "approve" ? "Decision approved → ready for execution" : "Decision rejected");
    },
    onError: () => toast.error("Review action failed"),
  });

  if (items.length === 0 && !isLoading) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-4 text-center">
          <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">Review queue clear — all decisions processed.</p>
        </CardContent>
      </Card>
    );
  }

  const criticalCount = items.filter(i => i.severity_score >= 8).length;

  return (
    <Card className={criticalCount > 0 ? "border-destructive/30" : "border-border"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-primary" /> Human Review Queue
          <Badge variant={criticalCount > 0 ? "destructive" : "secondary"} className="text-[9px] h-4 ml-1">
            {items.length} pending
          </Badge>
          {criticalCount > 0 && (
            <Badge variant="destructive" className="text-[9px] h-4">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />{criticalCount} critical
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
        {items.map(item => {
          const isOpen = expandedId === item.id;
          const severityColor = item.severity_score >= 8 ? "destructive" : item.severity_score >= 5 ? "outline" : "secondary";
          
          return (
            <div key={item.id} className={`border rounded ${item.severity_score >= 8 ? "border-destructive/30 bg-destructive/5" : "border-border/50"}`}>
              <div
                className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-muted/30"
                onClick={() => setExpandedId(isOpen ? null : item.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.signal_summary}</p>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    <Badge variant={severityColor} className="text-[9px] h-4">
                      Sev {item.severity_score}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] h-4">{item.domain}</Badge>
                    {item.country_iso3 && (
                      <Badge variant="outline" className="text-[9px] h-4">{item.country_iso3}</Badge>
                    )}
                    {item.confidence != null && (
                      <Badge variant="outline" className="text-[9px] h-4">
                        {Math.round(item.confidence * 100)}% conf
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-6 text-[10px] px-2"
                    onClick={(e) => { e.stopPropagation(); reviewAction.mutate({ id: item.id, action: "approve" }); }}
                  >
                    <CheckCircle className="h-2.5 w-2.5 mr-0.5" />Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2"
                    onClick={(e) => { e.stopPropagation(); reviewAction.mutate({ id: item.id, action: "reject" }); }}
                  >
                    <XCircle className="h-2.5 w-2.5 mr-0.5" />Reject
                  </Button>
                </div>
                {isOpen ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
              </div>
              {isOpen && (
                <div className="border-t border-border/50 p-3 space-y-2 bg-muted/10">
                  {item.review_notes && (
                    <div className="text-[10px]">
                      <span className="text-muted-foreground font-medium">Review Note: </span>
                      <span>{item.review_notes}</span>
                    </div>
                  )}
                  {item.reasoning_md && (
                    <div className="text-[10px]">
                      <span className="text-muted-foreground font-medium">AI Reasoning: </span>
                      <span className="whitespace-pre-wrap">{item.reasoning_md.slice(0, 300)}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    Created: {new Date(item.created_at).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
