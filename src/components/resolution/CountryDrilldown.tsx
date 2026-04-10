import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, Map, MapPin, BarChart3, TrendingDown, TrendingUp, Minus, AlertTriangle } from "lucide-react";
import { CountryRecommendations } from "./ResolutionRecommendations";

interface Props {
  iso3: string;
  countryName: string;
  onSelectRegion: (regionId: string, regionName: string) => void;
  onBack: () => void;
}

export const CountryDrilldown = ({ iso3, countryName, onSelectRegion, onBack }: Props) => {
  // Domain snapshots for this country
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

  // Regions for this country
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

  // Village indicator stats for this country
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

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Global
      </Button>

      {/* Country header */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold text-foreground">{countryName}</h2>
              <p className="text-xs text-muted-foreground font-mono">{iso3}</p>
            </div>
            <div className="flex gap-3">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Domains</p>
                <p className="text-lg font-bold text-primary">{domains?.length || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Regions</p>
                <p className="text-lg font-bold text-primary">{regions?.length || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Village Data</p>
                <p className="text-lg font-bold text-primary">
                  {villageStats?.indicatorCount ? `${(villageStats.indicatorCount / 1000).toFixed(0)}K` : "—"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Domain performance grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Macro — Domain Performance
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
                    <span className="text-sm font-medium capitalize">{d.domain}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${riskColor(d.risk_pressure_score)}`}>
                      Risk {d.risk_pressure_score.toFixed(0)}
                    </Badge>
                    <span className={`text-xs font-mono font-bold ${riskColor(d.risk_pressure_score)}`}>
                      {d.performance_index.toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolution-Aware Recommendations */}
      <CountryRecommendations domains={domains as any} />

      {/* Regions list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Map className="h-4 w-4 text-amber-500" />
            Meso — Sub-National Regions
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
