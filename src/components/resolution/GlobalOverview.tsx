import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Map, MapPin, ArrowRight, TrendingDown, TrendingUp, Minus, Package, AlertTriangle } from "lucide-react";
import { DecisionPropagationPanel } from "./DecisionPropagationPanel";
import { RiskHeatMap } from "./RiskHeatMap";
import { GlobalRiskMap } from "./InteractiveRiskMap";
import { WatchButton } from "@/components/watchlist/WatchButton";

interface Props {
  onSelectCountry: (iso3: string, name: string) => void;
}

export const GlobalOverview = ({ onSelectCountry }: Props) => {
  const { data: stats } = useQuery({
    queryKey: ["resolution-global-stats"],
    queryFn: async () => {
      const [snapshots, regions, villages] = await Promise.all([
        supabase.from("country_performance_snapshots").select("iso3", { count: "exact", head: true }),
        supabase.from("admin_regions").select("id", { count: "exact", head: true }),
        supabase.from("village_indicators").select("id", { count: "exact", head: true }),
      ]);
      return {
        countries: 211,
        regions: regions.count || 24774,
        villageIndicators: villages.count || 2570840,
      };
    },
    staleTime: 60_000,
  });

  const { data: topCountries, isLoading: countriesLoading } = useQuery({
    queryKey: ["resolution-top-countries"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("country_performance_snapshots")
        .select("iso3, risk_pressure_score, momentum_score, forecast_direction, domain")
        .eq("snapshot_date", today)
        .order("risk_pressure_score", { ascending: false })
        .limit(200);

      if (!data?.length) return [];

      interface CountryAgg { iso3: string; avgRisk: number; avgMomentum: number; domains: number; directions: string[] }
      const map: Record<string, CountryAgg> = {};
      for (const row of data) {
        if (!map[row.iso3]) map[row.iso3] = { iso3: row.iso3, avgRisk: 0, avgMomentum: 0, domains: 0, directions: [] };
        const existing = map[row.iso3];
        existing.avgRisk += row.risk_pressure_score;
        existing.avgMomentum += row.momentum_score;
        existing.domains += 1;
        if (row.forecast_direction) existing.directions.push(row.forecast_direction);
      }

      return Object.values(map)
        .map((c) => ({
          iso3: c.iso3,
          avgRisk: c.avgRisk / c.domains,
          avgMomentum: c.avgMomentum / c.domains,
          domains: c.domains,
          netDirection: c.directions.filter((d) => d === "down").length > c.directions.length / 2 ? "down" : c.directions.filter((d) => d === "up").length > c.directions.length / 2 ? "up" : "stable",
        }))
        .sort((a, b) => b.avgRisk - a.avgRisk)
        .slice(0, 20);
    },
    staleTime: 60_000,
  });

  const directionIcon = (d: string) => {
    if (d === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
    if (d === "up") return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const countryNames: Record<string, string> = {
    AFG: "Afghanistan", AGO: "Angola", BDI: "Burundi", BFA: "Burkina Faso", CAF: "Central African Republic",
    COD: "DR Congo", ETH: "Ethiopia", HTI: "Haiti", IRQ: "Iraq", LBY: "Libya",
    MLI: "Mali", MMR: "Myanmar", MOZ: "Mozambique", NGA: "Nigeria", PAK: "Pakistan",
    SDN: "Sudan", SOM: "Somalia", SSD: "South Sudan", SYR: "Syria", TCD: "Chad",
    UKR: "Ukraine", VEN: "Venezuela", YEM: "Yemen", ZWE: "Zimbabwe", NER: "Niger",
    USA: "United States", GBR: "United Kingdom", DEU: "Germany", FRA: "France", CHN: "China",
    IND: "India", BRA: "Brazil", RUS: "Russia", ZAF: "South Africa", KEN: "Kenya",
    RWA: "Rwanda", TZA: "Tanzania", UGA: "Uganda", GHA: "Ghana", SEN: "Senegal",
    TUR: "Turkey", EGY: "Egypt", SAU: "Saudi Arabia", ARE: "UAE", VNM: "Vietnam",
    THA: "Thailand", IDN: "Indonesia", MYS: "Malaysia", PHL: "Philippines", BGD: "Bangladesh",
  };

  return (
    <div className="space-y-4">
      {/* Supply chain context */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Where Your Supply Chain Is Most Exposed</span>
          </div>
          <p className="text-xs text-muted-foreground">
            This map shows risk levels across trade markets, sourcing regions, and logistics corridors. 
            Click any country to see domain-level risk, business impact, and recommended actions.
          </p>
        </CardContent>
      </Card>

      {/* Resolution tiers — simplified */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { icon: Globe, label: "Market Level", value: "211 Markets", sub: "Country-level risk across 9 domains", color: "text-blue-500", bg: "bg-blue-500/10" },
          { icon: Map, label: "Region Level", value: stats ? `${stats.regions.toLocaleString()} Regions` : "24,774 Regions", sub: "Sub-national risk concentration", color: "text-amber-500", bg: "bg-amber-500/10" },
          { icon: MapPin, label: "Local Level", value: stats ? `${(stats.villageIndicators / 1_000_000).toFixed(1)}M Data Points` : "2.57M Points", sub: "Village-level indicators", color: "text-emerald-500", bg: "bg-emerald-500/10" },
        ].map((tier) => (
          <Card key={tier.label} className="border-border/50">
            <CardContent className="p-4 flex items-start gap-3">
              <div className={`p-2 rounded-lg ${tier.bg} shrink-0`}>
                <tier.icon className={`h-5 w-5 ${tier.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">{tier.label}</p>
                <p className="text-lg font-bold text-foreground">{tier.value}</p>
                <p className="text-xs text-muted-foreground">{tier.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Disruption propagation — commercial framing */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            How Disruptions Propagate Through Your Supply Chain
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Local disruption</Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Regional supply stress</Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">Market price impact</Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">Action: Hedge or switch supplier</Badge>
          </div>
        </CardContent>
      </Card>

      <GlobalRiskMap onSelectCountry={onSelectCountry} />
      <DecisionPropagationPanel />
      <RiskHeatMap onSelectCountry={onSelectCountry} />

      {/* Country list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Top Trade Risk Markets — Click to Drill Down
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {countriesLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {topCountries?.map((c) => (
                <button
                  key={c.iso3}
                  onClick={() => onSelectCountry(c.iso3, countryNames[c.iso3] || c.iso3)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground w-8">{c.iso3}</span>
                    <span className="text-sm font-medium text-foreground">{countryNames[c.iso3] || c.iso3}</span>
                    <Badge variant="outline" className="text-[10px]">{c.domains} domains</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <WatchButton watchType="country" label={countryNames[c.iso3] || c.iso3} countryIso3={c.iso3} />
                    <div className="text-right">
                      <span className="text-xs text-muted-foreground">Risk</span>
                      <p className={`text-sm font-bold ${c.avgRisk > 60 ? "text-red-500" : c.avgRisk > 40 ? "text-amber-500" : "text-green-500"}`}>
                        {c.avgRisk.toFixed(0)}
                      </p>
                    </div>
                    {directionIcon(c.netDirection)}
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
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
