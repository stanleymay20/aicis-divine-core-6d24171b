import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Zap, Loader2, CheckCircle2 } from "lucide-react";

export default function InferenceControl() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ total: number; failed: number } | null>(null);

  const { currentLevel } = useMfaAssurance();
  const needsMfa = currentLevel !== "aal2";
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("trigger-daily-inference");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setResult({ total: data?.total_recommendations ?? 0, failed: data?.failed_domains ?? 0 });
      queryClient.invalidateQueries({ queryKey: ["daily-measured-queue"] });
      queryClient.invalidateQueries({ queryKey: ["new-decisions-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["daily-throughput"] });
      queryClient.invalidateQueries({ queryKey: ["measured-evidence-today"] });
      toast.success(`Generated ${data?.total_recommendations ?? 0} recommendations`);
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <Card className="border-border/50">
      <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Generate Fresh Decisions</p>
          <p className="text-xs text-muted-foreground">Run inference across all domains</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result && (
            <Badge variant={result.failed > 0 ? "destructive" : "default"} className="text-xs font-mono hidden sm:inline-flex">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {result.total} recs
            </Badge>
          )}
          <Button size="sm" onClick={() => (needsMfa ? toast.error("This action needs two-step sign-in (MFA). It still runs automatically on schedule.") : run.mutate())} title={needsMfa ? "Requires two-step sign-in (MFA)" : undefined} disabled={run.isPending} className="h-9 text-xs px-4">
            {run.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
            {run.isPending ? "Running…" : "Run Now"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
