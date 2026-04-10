import { useTopSignals } from "@/hooks/useGlobalSignals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Radio, TrendingUp, Clock, ArrowRight, Info, Loader2, AlertTriangle, Target, DollarSign, Package } from "lucide-react";
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
  if (score >= 60) return "text-amber-500";
  return "text-muted-foreground";
}

function quickImpactEstimate(score: number): string {
  if (score >= 80) return "€1M+";
  if (score >= 70) return "€500K+";
  if (score >= 60) return "€200K+";
  return "€50K+";
}

function businessInterpretation(category: string, impact: number): string {
  const map: Record<string, string> = {
    energy: "May cause fuel cost spikes and transport delays",
    geopolitical: "Could disrupt trade routes or sourcing contracts",
    climate_disaster: "Risk of port closures, crop failures, or shipping delays",
    supply_chain: "Direct supply chain disruption — sourcing or logistics affected",
    infrastructure: "Transport or port infrastructure may be impacted",
    defense_conflict: "Conflict zone may affect shipping lanes or supplier access",
    public_health: "Workforce or logistics disruption risk from health event",
    economic: "Currency or pricing volatility may affect procurement costs",
    financial_markets: "Market instability may affect payment or credit terms",
    legal_regulatory: "Regulatory change may affect import/export compliance",
    social_unrest: "Civil disruption may affect local operations or deliveries",
    cybersecurity: "Cyber threat to logistics systems or payment infrastructure",
    elections: "Political transition may change trade policies",
    central_banking: "Monetary policy shift may affect exchange rates and costs",
    technology: "Technology disruption may affect supply chain systems",
  };
  return map[category] || "May affect trade operations, sourcing, or delivery timelines";
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
            Top Supply Chain Risks
          </span>
          <button
            onClick={() => navigate("/live")}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            All Risks <ArrowRight className="h-3 w-3" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading risks…</span>
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Failed to load risk data.
          </div>
        ) : signals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Info className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No active supply chain risks detected.</p>
            <p className="text-xs text-muted-foreground">Risks appear after the detection and enrichment pipeline runs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {signals.map((signal, i) => (
              <div
                key={signal.id}
                className={cn(
                  "p-3 rounded-lg border cursor-pointer hover:border-primary/40 transition-colors",
                  signal.impact_score >= 80 ? "border-destructive/30 bg-destructive/5" : "border-border/50"
                )}
                onClick={() => navigate("/live")}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground mt-0.5 shrink-0">
                    #{i + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <h4 className="text-xs font-semibold leading-tight line-clamp-2">{signal.title}</h4>
                    
                    {/* Business interpretation */}
                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                      <Package className="h-2.5 w-2.5 inline mr-0.5" />
                      {businessInterpretation(signal.category, signal.impact_score)}
                    </p>

                    {/* Score strip */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("text-[10px] font-mono font-bold", impactColor(signal.impact_score))}>
                        <TrendingUp className="h-2.5 w-2.5 inline mr-0.5" />
                        {signal.impact_score}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {timeAgo(signal.first_detected_at)}
                      </span>
                      <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-0.5">
                        <DollarSign className="h-2.5 w-2.5" />
                        {quickImpactEstimate(signal.impact_score)} potential loss
                      </span>
                      {signal.affected_countries?.slice(0, 2).map(r => (
                        <Badge key={r} variant="secondary" className="text-[8px] h-3.5 px-1">
                          {r}
                        </Badge>
                      ))}
                    </div>

                    {/* Recommended business action */}
                    {signal.recommended_actions?.business || signal.recommended_actions?.government ? (
                      <div className="bg-primary/5 rounded px-2 py-1.5 flex items-start gap-1.5">
                        <Target className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                        <span className="text-[11px] font-medium text-foreground line-clamp-1">
                          {signal.recommended_actions.business || signal.recommended_actions.government}
                        </span>
                      </div>
                    ) : (
                      <div className="bg-muted/50 rounded px-2 py-1.5 flex items-center gap-1.5">
                        <Target className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-[11px] text-muted-foreground">
                          Create an action from this risk →
                        </span>
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
