import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, ArrowRight, CheckCircle2, DollarSign,
  Shield, Target, TrendingUp, Clock, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionableInsightProps {
  title: string;
  risk: string;
  action: string;
  expectedImpact?: string;
  estimatedROI?: number;
  confidence: number;
  precedent?: string;
  timeframe?: string;
  urgency: "critical" | "high" | "medium";
  domain?: string;
  onExecute?: () => void;
  onDismiss?: () => void;
  executing?: boolean;
}

const URGENCY_RING = {
  critical: "border-l-destructive",
  high: "border-l-amber-500",
  medium: "border-l-primary",
};

const URGENCY_BG = {
  critical: "bg-destructive/5",
  high: "bg-amber-500/5",
  medium: "bg-card",
};

export const ActionableInsightCard = ({
  title, risk, action, expectedImpact, estimatedROI,
  confidence, precedent, timeframe, urgency, domain,
  onExecute, onDismiss, executing,
}: ActionableInsightProps) => {
  return (
    <Card className={cn(
      "border-l-4 transition-colors hover:shadow-md",
      URGENCY_RING[urgency],
      URGENCY_BG[urgency],
    )}>
      <CardContent className="p-4 space-y-3">
        {/* Row 1: Risk headline */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className={cn(
                "h-4 w-4 shrink-0",
                urgency === "critical" ? "text-destructive" : urgency === "high" ? "text-amber-500" : "text-primary"
              )} />
              <Badge variant={urgency === "critical" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                {urgency} risk
              </Badge>
              {domain && (
                <Badge variant="outline" className="text-[10px]">{domain}</Badge>
              )}
            </div>
            <h3 className="text-sm font-bold leading-snug">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{risk}</p>
          </div>
        </div>

        {/* Row 2: THE ACTION — bold, unmissable */}
        <div className="rounded-lg bg-primary/10 border border-primary/20 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-primary shrink-0" />
            <span className="text-[10px] uppercase tracking-wider font-bold text-primary">Recommended Action</span>
          </div>
          <p className="text-sm font-semibold text-foreground leading-snug">{action}</p>
          {timeframe && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Act within {timeframe}
            </p>
          )}
        </div>

        {/* Row 3: Impact + ROI + Confidence strip */}
        <div className="grid grid-cols-3 gap-2">
          {expectedImpact && (
            <div className="rounded-md bg-muted/50 p-2 text-center">
              <DollarSign className="h-3.5 w-3.5 mx-auto mb-0.5 text-emerald-500" />
              <p className="text-xs font-bold text-emerald-500">{expectedImpact}</p>
              <p className="text-[9px] text-muted-foreground">Expected Impact</p>
            </div>
          )}
          {estimatedROI != null && estimatedROI > 0 && (
            <div className="rounded-md bg-muted/50 p-2 text-center">
              <TrendingUp className="h-3.5 w-3.5 mx-auto mb-0.5 text-primary" />
              <p className="text-xs font-bold text-primary">{estimatedROI.toFixed(1)}x</p>
              <p className="text-[9px] text-muted-foreground">Est. ROI</p>
            </div>
          )}
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <Shield className="h-3.5 w-3.5 mx-auto mb-0.5 text-foreground" />
            <p className="text-xs font-bold">{confidence}%</p>
            <p className="text-[9px] text-muted-foreground">Confidence</p>
          </div>
        </div>

        {/* Row 4: Precedent — "Based on similar past events" */}
        {precedent && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
            <Zap className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <p className="leading-relaxed">
              <span className="font-medium text-foreground">Historical precedent:</span> {precedent}
            </p>
          </div>
        )}

        {/* Row 5: Execute / Dismiss */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="h-9 text-xs gap-1.5 flex-1 sm:flex-none font-semibold"
            onClick={onExecute}
            disabled={executing}
          >
            <CheckCircle2 className="h-4 w-4" />
            Execute This Decision
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-xs text-muted-foreground"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
