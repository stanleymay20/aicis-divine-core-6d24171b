import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Brain, Globe, RefreshCw, Shield, TrendingUp } from "lucide-react";

interface Props {
  activeDivisions: number;
  totalDivisions: number;
  alertsCount: number | undefined;
  predictionsCount: number | undefined;
  organizationsCount: number;
  onSyncData: () => void;
  onGeneratePredictions: () => void;
  onRunVulnScan: () => void;
  isSyncing: boolean;
  isGenerating: boolean;
  isScanning: boolean;
}

export function OverviewTab(p: Props) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Active Divisions</p><p className="text-3xl font-bold text-primary">{p.activeDivisions}/{p.totalDivisions}</p></div>
          <Brain className="h-8 w-8 text-primary/50" />
        </div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Active Alerts</p><p className="text-3xl font-bold text-destructive">{p.alertsCount}</p></div>
          <AlertTriangle className="h-8 w-8 text-destructive/50" />
        </div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Predictions</p><p className="text-3xl font-bold text-primary">{p.predictionsCount}</p></div>
          <TrendingUp className="h-8 w-8 text-primary/50" />
        </div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between">
          <div><p className="text-sm text-muted-foreground">Organizations</p><p className="text-3xl font-bold text-primary">{p.organizationsCount}</p></div>
          <Globe className="h-8 w-8 text-primary/50" />
        </div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Quick Actions</CardTitle><CardDescription>System maintenance and data operations</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={p.onSyncData} disabled={p.isSyncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${p.isSyncing ? "animate-spin" : ""}`} />Sync Live Data
          </Button>
          <Button onClick={p.onGeneratePredictions} disabled={p.isGenerating} variant="secondary">
            <Brain className={`w-4 h-4 mr-2 ${p.isGenerating ? "animate-pulse" : ""}`} />Generate Predictions
          </Button>
          <Button onClick={p.onRunVulnScan} disabled={p.isScanning} variant="outline">
            <Shield className={`w-4 h-4 mr-2 ${p.isScanning ? "animate-pulse" : ""}`} />Run Vulnerability Scan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
