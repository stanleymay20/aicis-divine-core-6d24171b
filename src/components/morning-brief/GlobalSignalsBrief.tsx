import { useTopSignals } from "@/hooks/useGlobalSignals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Radio, TrendingUp, Clock, ArrowRight, Info, Loader2, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function impactColor(score: number) {
  if (score >= 80) return "text-destructive";
  if (score >= 60) return "text-warning";
  return "text-muted-foreground";
}

export function GlobalSignalsBrief() {
  const { data: signals = [], isLoading, isError } = useTopSignals(5);
  const navigate = useNavigate();

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Radio className="h-4 w-4 text-destructive animate-pulse" />
            Top Global Signals
          </span>
          <button
            onClick={() => navigate("/live")}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            Live Feed <ArrowRight className="h-3 w-3" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading signals…</span>
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Failed to load signals.
          </div>
        ) : signals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Info className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No enriched signals available yet.</p>
            <p className="text-xs text-muted-foreground">Signals appear after the ingestion and enrichment pipeline runs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {signals.map((signal, i) => (
              <div
                key={signal.id}
                className={cn(
                  "p-2 rounded border cursor-pointer hover:border-primary/40 transition-colors",
                  signal.impact_score >= 80 ? "border-destructive/30 bg-destructive/5" : "border-border/50"
                )}
                onClick={() => navigate("/live")}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground mt-0.5 shrink-0">
                    #{i + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <h4 className="text-xs font-semibold leading-tight line-clamp-2">{signal.title}</h4>
                    {signal.strategic_implications && (
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        {signal.strategic_implications}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("text-[10px] font-mono font-bold", impactColor(signal.impact_score))}>
                        <TrendingUp className="h-2.5 w-2.5 inline mr-0.5" />
                        {signal.impact_score}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {timeAgo(signal.first_detected_at)}
                      </span>
                      {signal.affected_regions?.slice(0, 2).map(r => (
                        <Badge key={r} variant="secondary" className="text-[8px] h-3.5 px-1">
                          {r}
                        </Badge>
                      ))}
                    </div>
                    {signal.recommended_actions?.government && (
                      <div className="text-[10px] text-primary/80 mt-0.5">
                        → {signal.recommended_actions.government}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
