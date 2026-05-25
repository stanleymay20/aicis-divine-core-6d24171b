import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Database, Lock, Server, Shield, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  onSyncData: () => void;
  onGeneratePredictions: () => void;
  onRunVulnScan: () => void;
}

export function ActionsTab({ onSyncData, onGeneratePredictions, onRunVulnScan }: Props) {
  const { toast } = useToast();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle>Data Operations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full justify-start" variant="outline" onClick={onSyncData}>
            <Database className="w-4 h-4 mr-2" />Sync All Global Data Sources
          </Button>
          <Button className="w-full justify-start" variant="outline" onClick={onGeneratePredictions}>
            <TrendingUp className="w-4 h-4 mr-2" />Generate AI Predictions
          </Button>
          <Button className="w-full justify-start" variant="outline" onClick={onRunVulnScan}>
            <Shield className="w-4 h-4 mr-2" />Calculate Vulnerability Scores
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>System Operations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full justify-start" variant="outline" onClick={async () => {
            const { error } = await supabase.functions.invoke("aicis-self-heal");
            if (!error) toast({ title: "Self-heal initiated" });
          }}>
            <Server className="w-4 h-4 mr-2" />Run Self-Healing Diagnostics
          </Button>
          <Button className="w-full justify-start" variant="outline" onClick={async () => {
            const { error } = await supabase.functions.invoke("cron-daily-learn");
            if (!error) toast({ title: "Learning cycle initiated" });
          }}>
            <Brain className="w-4 h-4 mr-2" />Trigger Learning Cycle
          </Button>
          <Button className="w-full justify-start" variant="outline" onClick={async () => {
            const { error } = await supabase.functions.invoke("compute-trust-metrics");
            if (!error) toast({ title: "Trust metrics computed" });
          }}>
            <Lock className="w-4 h-4 mr-2" />Compute Trust Metrics
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
