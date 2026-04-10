import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, BarChart3 } from "lucide-react";

interface Props {
  history: Array<{
    turning_point_accuracy: number;
    break_detection_score: number;
    intelligence_grade: string;
    total_forecasts_evaluated: number;
    created_at: string;
  }>;
  calibration: Array<{
    metric_name: string;
    metric_value: number;
    domain: string | null;
    computed_at: string;
  }>;
}

export const CalibrationTrendChart = ({ history, calibration }: Props) => {
  // Find domain-level calibration metrics
  const domainMetrics = calibration.filter((c) => c.domain && c.domain !== "all");
  const domainGroups = domainMetrics.reduce((acc, m) => {
    const key = m.domain!;
    if (!acc[key]) acc[key] = {};
    acc[key][m.metric_name] = m.metric_value;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  // Bar chart using CSS
  const maxTP = Math.max(...history.map((h) => h.turning_point_accuracy), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Intelligence Score Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Intelligence Score Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No snapshot history yet</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-end gap-0.5 h-32">
                {history.slice(-20).map((h, i) => {
                  const pct = (h.turning_point_accuracy / Math.max(maxTP, 100)) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center" title={`${h.turning_point_accuracy}% — ${new Date(h.created_at).toLocaleDateString()}`}>
                      <div
                        className="w-full rounded-t bg-primary/70 min-h-[2px] transition-all hover:bg-primary"
                        style={{ height: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>{history.length > 0 ? new Date(history[0].created_at).toLocaleDateString() : ""}</span>
                <span>Turning Point Accuracy %</span>
                <span>{history.length > 0 ? new Date(history[history.length - 1].created_at).toLocaleDateString() : ""}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Domain Calibration */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-amber-500" />
            Domain Calibration Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(domainGroups).length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No domain-level calibration data yet</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(domainGroups).slice(0, 8).map(([domain, metrics]) => (
                <div key={domain} className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium capitalize w-20 truncate">{domain}</span>
                  <div className="flex-1 flex items-center gap-2">
                    {metrics.mae !== undefined && (
                      <span className="text-[10px] text-muted-foreground">MAE: {metrics.mae.toFixed(1)}</span>
                    )}
                    {metrics.stability_score !== undefined && (
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div
                          className="bg-emerald-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${metrics.stability_score * 100}%` }}
                        />
                      </div>
                    )}
                    {metrics.stability_score !== undefined && (
                      <span className="text-[10px] font-mono text-emerald-500">{(metrics.stability_score * 100).toFixed(0)}%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
