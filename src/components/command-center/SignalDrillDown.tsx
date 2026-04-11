import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle, Clock, Globe, Target, DollarSign, TrendingUp,
  Shield, Package, MapPin, Zap, CheckCircle2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ExecuteActionDialog } from "./ExecuteActionDialog";

interface Signal {
  id: string;
  title: string;
  summary: string;
  category: string;
  impact_score: number;
  urgency_score: number;
  confidence_score: number;
  affected_regions?: string[];
  affected_countries?: string[];
  affected_sectors?: string[];
  strategic_implications?: string;
  likely_consequences?: string;
  recommended_actions?: { business?: string; government?: string; media?: string; public?: string };
  first_detected_at: string;
  source_trust_tier?: string;
  source_count?: number;
}

interface Props {
  signal: Signal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function estimateImpact(score: number): string {
  if (score >= 80) return "€1M+";
  if (score >= 70) return "€500K+";
  if (score >= 60) return "€200K+";
  return "€50K+";
}

function businessInterpretation(category: string): string {
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
  };
  return map[category] || "May affect trade operations, sourcing, or delivery timelines";
}

function urgencyLevel(impact: number, urgency: number): "critical" | "high" | "medium" {
  const combined = impact * 0.6 + urgency * 0.4;
  if (combined >= 80) return "critical";
  if (combined >= 60) return "high";
  return "medium";
}

export function SignalDrillDown({ signal, open, onOpenChange }: Props) {
  const [executeOpen, setExecuteOpen] = useState(false);

  if (!signal) return null;

  const urgency = urgencyLevel(signal.impact_score, signal.urgency_score);
  const action = signal.recommended_actions?.business || signal.recommended_actions?.government || signal.strategic_implications || "Review and assess impact on your supply chain";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
          <div className="p-5 space-y-4">
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={urgency === "critical" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                  {urgency}
                </Badge>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(signal.first_detected_at)}
                </span>
              </div>
              <SheetTitle className="text-lg leading-tight">{signal.title}</SheetTitle>
            </SheetHeader>

            {/* Signal Details */}
            <Card className="border-border/50">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signal Details</h4>
                <p className="text-sm text-foreground leading-relaxed">{signal.summary}</p>
                {signal.likely_consequences && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{signal.likely_consequences}</p>
                )}
              </CardContent>
            </Card>

            {/* Affected regions */}
            {(signal.affected_countries?.length || signal.affected_regions?.length) ? (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Globe className="h-3 w-3" /> Affected Trade Markets
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {signal.affected_countries?.map(c => (
                    <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                  ))}
                  {signal.affected_regions?.map(r => (
                    <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Impact Analysis */}
            <Card className={cn(
              "border-l-4",
              urgency === "critical" ? "border-l-destructive" : urgency === "high" ? "border-l-amber-500" : "border-l-primary"
            )}>
              <CardContent className="p-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Impact Analysis</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <DollarSign className="h-4 w-4 mx-auto mb-1 text-destructive" />
                    <p className="text-lg font-bold text-destructive">{estimateImpact(signal.impact_score)}</p>
                    <p className="text-[10px] text-muted-foreground">Potential exposure</p>
                  </div>
                  <div className="text-center">
                    <TrendingUp className="h-4 w-4 mx-auto mb-1 text-foreground" />
                    <p className="text-lg font-bold">{signal.impact_score}</p>
                    <p className="text-[10px] text-muted-foreground">Impact score</p>
                  </div>
                  <div className="text-center">
                    <Shield className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-lg font-bold">{signal.confidence_score || 50}%</p>
                    <p className="text-[10px] text-muted-foreground">Confidence</p>
                  </div>
                </div>

                {/* Business interpretation */}
                <div className="bg-muted/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-semibold text-primary uppercase">Business Impact</span>
                  </div>
                  <p className="text-xs text-foreground">{businessInterpretation(signal.category)}</p>
                </div>

                {signal.strategic_implications && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {signal.strategic_implications}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Source info */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {signal.source_trust_tier && (
                <Badge variant="outline" className="text-[10px]">
                  Source: {signal.source_trust_tier}
                </Badge>
              )}
              {signal.source_count && signal.source_count > 1 && (
                <Badge variant="outline" className="text-[10px]">
                  {signal.source_count} sources
                </Badge>
              )}
            </div>

            {/* Recommended Action */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Recommended Action</h4>
                </div>
                <p className="text-sm font-semibold">{action}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Act within {urgency === "critical" ? "24 hours" : urgency === "high" ? "48 hours" : "1 week"}
                </p>
                <Button
                  className="w-full gap-2"
                  onClick={() => setExecuteOpen(true)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Execute This Action
                </Button>
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      <ExecuteActionDialog
        open={executeOpen}
        onOpenChange={setExecuteOpen}
        signal={signal}
        recommendedAction={action}
        onSuccess={() => onOpenChange(false)}
      />
    </>
  );
}
