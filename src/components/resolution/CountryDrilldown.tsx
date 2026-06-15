import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, Map, MapPin, BarChart3, TrendingDown, TrendingUp, Minus, AlertTriangle, Package, Target } from "lucide-react";
import { CountryRecommendations } from "./ResolutionRecommendations";
import { CountryRiskMap } from "./InteractiveRiskMap";
import { WatchButton } from "@/components/watchlist/WatchButton";
import { cn } from "@/lib/utils";
import { EvidenceSection } from "@/components/evidence/EvidenceSection";

interface Props {
  iso3: string;
  countryName: string;
  onSelectRegion: (regionId: string, regionName: string) => void;
  onBack: () => void;
}

const DOMAIN_BUSINESS_IMPACT: Record<string, string> = {
  health: "Workforce disruption risk",
  food: "Input price / sourcing risk",
  energy: "Fuel cost / transport cost risk",
  economy: "Payment / FX exposure",
  governance: "Regulatory / compliance risk",
  security: "Physical security / access risk",
  climate: "Weather / shipping delay risk",
  education: "Skilled labor availability",
  infrastructure: "Logistics / port reliability",
};

export const CountryDrilldown = ({ iso3, countryName, onSelectRegion, onBack }: Props) => {
  const { data: domains, isLoading: domainsLoading } = useQuery({
    queryKey: ["resolution-country-domains", iso3],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("country_performance_snapshots")
        .select("domain, performance_index, risk_pressure_score, momentum_score, forecast_direction, systemic_fragility_score, confidence_score")
        .eq("iso3", iso3)
        .eq("snapshot_date", today);
      return data || [];
    },
  });

  const { data: regions, isLoading: regionsLoading } = useQuery({
    queryKey: ["resolution-country-regions", iso3],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level, population_est, urban_rural, lat, lon")
        .eq("country_iso3", iso3)
        .in("admin_level", [1, 2])
        .order("admin_level", { ascending: true })
        .order("name", { ascending: true })
        .limit(50);
      return data || [];
    },
  });

  const { data: villageStats } = useQuery({
    queryKey: ["resolution-country-village-stats", iso3],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id")
        .eq("country_iso3", iso3);
      if (!data?.length) return { regions: 0, hasVillageData: false };
      const regionIds = data.map((r) => r.id);
      const { count } = await supabase
        .from("village_indicators")
        .select("id", { count: "exact", head: true })
        .in("region_id", regionIds.slice(0, 100));
      return { regions: data.length, hasVillageData: (count || 0) > 0, indicatorCount: count || 0 };
    },
  });

  const directionIcon = (d: string) => {
    if (d === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
    if (d === "up") return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const riskColor = (v: number) => (v > 60 ? "text-red-500" : v > 40 ? "text-amber-500" : "text-green-500");

  // Compute overall market risk
  const avgRisk = domains?.length
    ? domains.reduce((s, d) => s + d.risk_pressure_score, 0) / domains.length
    : 0;

  const stressedDomains = domains?.filter(d => d.risk_pressure_score > 50) || [];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Global Risk Map
      </Button>

      {/* Country header */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">{countryName}</h2>
                <p className="text-xs text-muted-foreground font-mono">{iso3} · Trade market profile</p>
              </div>
              <WatchButton watchType="country" label={countryName} countryIso3={iso3} />
            </div>
            <div className="flex gap-3">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Market Risk</p>
                <p className={cn("text-lg font-bold", riskColor(avgRisk))}>{avgRisk.toFixed(0)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Domains</p>
                <p className="text-lg font-bold text-primary">{domains?.length || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Regions</p>
                <p className="text-lg font-bold text-primary">{regions?.length || 0}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Business Impact Summary */}
      {stressedDomains.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Package className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold">Business Impact Summary</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {stressedDomains.slice(0, 4).map(d => (
                <div key={d.domain} className="flex items-center gap-2 text-xs">
                  <AlertTriangle className={cn("h-3 w-3 shrink-0", riskColor(d.risk_pressure_score))} />
                  <span className="font-medium capitalize">{d.domain}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-muted-foreground">{DOMAIN_BUSINESS_IMPACT[d.domain] || "Trade risk"}</span>
                  <Badge variant="outline" className={cn("text-[9px] ml-auto", riskColor(d.risk_pressure_score))}>
                    {d.risk_pressure_score.toFixed(0)}
                  </Badge>
                </div>
              ))}
            </div>
            {stressedDomains.length >= 3 && (
              <div className="mt-2 bg-primary/5 rounded px-2.5 py-1.5 flex items-start gap-1.5">
                <Target className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                <span className="text-[11px] font-medium">
                  Compounding disruption risk — consider diversifying sourcing or hedging exposure in this market
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Domain performance grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Domain Risk Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {domainsLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {domains?.map((d) => (
                <div key={d.domain} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card">
                  <div className="flex items-center gap-2">
                    {directionIcon(d.forecast_direction)}
                    <div>
                      <span className="text-sm font-medium capitalize">{d.domain}</span>
                      <p className="text-[10px] text-muted-foreground">{DOMAIN_BUSINESS_IMPACT[d.domain] || ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${riskColor(d.risk_pressure_score)}`}>
                      Risk {d.risk_pressure_score.toFixed(0)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EvidenceSection mode="country" iso3={iso3} />

      <CountryRecommendations domains={domains as any} />

      {/* Interactive map */}
      <CountryRiskMap iso3={iso3} countryName={countryName} onSelectRegion={onSelectRegion} />

      {/* Regions list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Map className="h-4 w-4 text-amber-500" />
            Sub-National Regions
            <Badge variant="secondary" className="text-[10px] ml-auto">{regions?.length || 0} regions</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {regionsLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : regions?.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <MapPin className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              No sub-national regions mapped yet for {countryName}
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {regions?.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelectRegion(r.id, r.name)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <MapPin className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-sm font-medium">{r.name}</span>
                    <Badge variant="outline" className="text-[10px]">Level {r.admin_level}</Badge>
                    {r.urban_rural && (
                      <Badge variant="secondary" className="text-[10px]">{r.urban_rural}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.population_est && (
                      <span className="text-xs text-muted-foreground">{(r.population_est / 1000).toFixed(0)}K pop</span>
                    )}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
