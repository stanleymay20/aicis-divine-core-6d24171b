import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, MapPin, Loader2, Info, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface RiskCountry {
  iso_code: string;
  country: string;
  overall_score: number;
  health_risk: number;
  food_risk: number;
  energy_risk: number;
  climate_risk: number;
  economic_risk: number;
  governance_risk: number;
}

const BUSINESS_IMPACT: Record<string, string> = {
  Health: "Workforce / logistics disruption",
  Food: "Input price volatility",
  Energy: "Fuel cost / transport delays",
  Climate: "Shipping / port risk",
  Economy: "Payment / FX exposure",
  Gov: "Regulatory / compliance risk",
};

export const TopRisksWidget = () => {
  const navigate = useNavigate();

  const { data: topRisks, isLoading, isError } = useQuery({
    queryKey: ["top-5-risks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vulnerability_scores")
        .select("iso_code, country, overall_score, health_risk, food_risk, energy_risk, climate_risk, economic_risk, governance_risk")
        .order("overall_score", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []) as unknown as RiskCountry[];
    },
    staleTime: 120_000,
  });

  const getRiskColor = (score: number) => {
    if (score >= 75) return "text-destructive";
    if (score >= 50) return "text-orange-500";
    if (score >= 30) return "text-yellow-500";
    return "text-muted-foreground";
  };

  const getRiskBadge = (score: number) => {
    if (score >= 75) return "destructive";
    if (score >= 50) return "secondary";
    return "outline";
  };

  const getTopDomain = (r: RiskCountry) => {
    const domains = [
      { name: "Health", score: r.health_risk },
      { name: "Food", score: r.food_risk },
      { name: "Energy", score: r.energy_risk },
      { name: "Climate", score: r.climate_risk },
      { name: "Economy", score: r.economic_risk },
      { name: "Gov", score: r.governance_risk },
    ];
    return domains.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Top 5 Risk Markets
          <Badge variant="outline" className="text-xs ml-auto">Live</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading market risk data…</span>
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Failed to load risk data. Try refreshing.
          </div>
        ) : !topRisks || topRisks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Info className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No market risk scores computed yet.</p>
            <p className="text-xs text-muted-foreground">Scores are generated after the risk engine runs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {topRisks.map((risk, i) => {
              const topDomain = getTopDomain(risk);
              return (
                <div
                  key={risk.iso_code || i}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/resolution`)}
                >
                  <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm truncate">{risk.country}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{risk.iso_code}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Package className="h-2.5 w-2.5" />
                      {BUSINESS_IMPACT[topDomain.name] || "Trade risk"} — {topDomain.name} ({Math.round(topDomain.score ?? 0)})
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-lg font-semibold ${getRiskColor(risk.overall_score)}`}>
                      {Math.round(risk.overall_score)}
                    </span>
                    <Badge variant={getRiskBadge(risk.overall_score) as any} className="text-[10px] ml-1.5">
                      {risk.overall_score >= 75 ? "CRITICAL" : risk.overall_score >= 50 ? "HIGH" : "MODERATE"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
