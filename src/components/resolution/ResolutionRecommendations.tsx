import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Shield, Zap, AlertTriangle } from "lucide-react";

type ResLevel = "country" | "region" | "village";

interface Recommendation {
  action: string;
  level: ResLevel;
  urgency: "critical" | "high" | "medium";
  type: "escalate" | "local" | "monitor";
}

function generateCountryRecommendations(
  domains: Array<{ domain: string; risk_pressure_score: number; forecast_direction: string; momentum_score: number }> | undefined
): Recommendation[] {
  if (!domains?.length) return [];
  const recs: Recommendation[] = [];

  const highRisk = domains.filter((d) => d.risk_pressure_score > 60);
  const declining = domains.filter((d) => d.forecast_direction === "down");

  if (highRisk.length >= 3) {
    recs.push({
      action: `Multi-domain risk detected across ${highRisk.length} sectors — escalate to strategic review`,
      level: "country",
      urgency: "critical",
      type: "escalate",
    });
  }

  for (const d of highRisk.slice(0, 2)) {
    recs.push({
      action: `${capitalize(d.domain)} risk at ${d.risk_pressure_score.toFixed(0)} — initiate sector-specific intervention`,
      level: "country",
      urgency: d.risk_pressure_score > 75 ? "critical" : "high",
      type: "local",
    });
  }

  if (declining.length > 0 && declining.length < domains.length) {
    recs.push({
      action: `${declining.length} domain${declining.length > 1 ? "s" : ""} trending down — monitor for regional cascade`,
      level: "region",
      urgency: "medium",
      type: "monitor",
    });
  }

  return recs.slice(0, 4);
}

function generateRegionRecommendations(
  indicators: Array<{ domain: string; value: number | null; confidence: number | null; indicator: string }> | undefined,
  childCount: number
): Recommendation[] {
  if (!indicators?.length) {
    return [{
      action: "No village data available — prioritize satellite inference for this region",
      level: "region",
      urgency: "medium",
      type: "monitor",
    }];
  }

  const recs: Recommendation[] = [];
  const lowConf = indicators.filter((i) => i.confidence !== null && i.confidence < 0.5);
  const domains = [...new Set(indicators.map((i) => i.domain))];

  if (lowConf.length > 3) {
    recs.push({
      action: `${lowConf.length} low-confidence indicators — escalate to national data validation`,
      level: "country",
      urgency: "high",
      type: "escalate",
    });
  }

  if (domains.includes("health")) {
    const healthInds = indicators.filter((i) => i.domain === "health");
    recs.push({
      action: `${healthInds.length} health indicators active — local health intervention recommended`,
      level: "village",
      urgency: "high",
      type: "local",
    });
  }

  if (childCount > 10) {
    recs.push({
      action: `${childCount} sub-regions mapped — drill into highest-risk settlements`,
      level: "village",
      urgency: "medium",
      type: "monitor",
    });
  }

  if (domains.length >= 3) {
    recs.push({
      action: `Cross-domain data available (${domains.slice(0, 3).map(capitalize).join(", ")}) — use for integrated assessment`,
      level: "region",
      urgency: "medium",
      type: "local",
    });
  }

  return recs.slice(0, 4);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TYPE_CONFIG = {
  escalate: { icon: ArrowUpRight, color: "text-red-500", label: "Escalate" },
  local: { icon: Zap, color: "text-primary", label: "Act here" },
  monitor: { icon: Shield, color: "text-amber-500", label: "Monitor" },
};

const URGENCY_BADGE = {
  critical: "destructive" as const,
  high: "secondary" as const,
  medium: "outline" as const,
};

interface CountryRecsProps {
  domains: Array<{ domain: string; risk_pressure_score: number; forecast_direction: string; momentum_score: number }> | undefined;
}

interface RegionRecsProps {
  indicators: Array<{ domain: string; value: number | null; confidence: number | null; indicator: string }> | undefined;
  childCount: number;
}

export function CountryRecommendations({ domains }: CountryRecsProps) {
  const recs = generateCountryRecommendations(domains);
  if (recs.length === 0) return null;
  return <RecommendationList recs={recs} />;
}

export function RegionRecommendations({ indicators, childCount }: RegionRecsProps) {
  const recs = generateRegionRecommendations(indicators, childCount);
  if (recs.length === 0) return null;
  return <RecommendationList recs={recs} />;
}

function RecommendationList({ recs }: { recs: Recommendation[] }) {
  return (
    <Card className="border-primary/20">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">Resolution-Aware Recommendations</span>
        </div>
        {recs.map((rec, i) => {
          const cfg = TYPE_CONFIG[rec.type];
          const Icon = cfg.icon;
          return (
            <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-md border border-border/50 bg-muted/30">
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-snug">{rec.action}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant={URGENCY_BADGE[rec.urgency]} className="text-[9px] h-4 uppercase">{rec.urgency}</Badge>
                  <Badge variant="outline" className="text-[9px] h-4">{cfg.label}</Badge>
                  <Badge variant="outline" className="text-[9px] h-4 capitalize">{rec.level} level</Badge>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
