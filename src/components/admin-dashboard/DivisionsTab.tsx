import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

export function DivisionsTab({ systemHealth, onRefetch }: { systemHealth: any[] | undefined; onRefetch: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">AI Divisions Status</h2>
        <Button variant="outline" size="sm" onClick={onRefetch}>
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {systemHealth?.map((division: any) => (
          <Card key={division.id} className={division.status === "active" ? "border-success/30" : "border-destructive/30"}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold capitalize">{division.division_key}</h3>
                <Badge variant={division.status === "active" ? "default" : "destructive"}>{division.status}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Performance</span><span className="font-medium">{division.performance_score?.toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Uptime</span><span className="font-medium">{division.uptime_percentage?.toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Check</span><span className="font-mono text-xs">{new Date(division.last_check).toLocaleTimeString()}</span></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
