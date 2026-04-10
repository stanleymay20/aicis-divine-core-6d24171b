import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, ArrowRight } from "lucide-react";
import { useMemo } from "react";

interface Props {
  onSelectCountry: (iso3: string, name: string) => void;
}

const COUNTRY_NAMES: Record<string, string> = {
  AFG: "Afghanistan", AGO: "Angola", ARG: "Argentina", AUS: "Australia", BDI: "Burundi",
  BFA: "Burkina Faso", BGD: "Bangladesh", BRA: "Brazil", CAF: "Central African Republic",
  CHN: "China", COD: "DR Congo", COL: "Colombia", DEU: "Germany", EGY: "Egypt",
  ETH: "Ethiopia", FRA: "France", GBR: "United Kingdom", GHA: "Ghana", GTM: "Guatemala",
  HTI: "Haiti", IDN: "Indonesia", IND: "India", IRN: "Iran", IRQ: "Iraq", ISR: "Israel",
  JPN: "Japan", KEN: "Kenya", LBY: "Libya", MEX: "Mexico", MLI: "Mali", MMR: "Myanmar",
  MOZ: "Mozambique", NGA: "Nigeria", PAK: "Pakistan", PER: "Peru", PHL: "Philippines",
  RUS: "Russia", RWA: "Rwanda", SAU: "Saudi Arabia", SDN: "Sudan", SEN: "Senegal",
  SOM: "Somalia", SSD: "South Sudan", SYR: "Syria", TCD: "Chad", THA: "Thailand",
  TUR: "Turkey", TZA: "Tanzania", UGA: "Uganda", UKR: "Ukraine", USA: "United States",
  VEN: "Venezuela", VNM: "Vietnam", YEM: "Yemen", ZAF: "South Africa", ZMB: "Zambia",
  ZWE: "Zimbabwe", NER: "Niger", CMR: "Cameroon", MWI: "Malawi", MDG: "Madagascar",
};

// Regions with approximate bounding-box mapping
const REGION_GROUPS: Array<{ label: string; iso3List: string[] }> = [
  { label: "Africa — West", iso3List: ["NGA", "GHA", "SEN", "MLI", "BFA", "NER", "CMR"] },
  { label: "Africa — East", iso3List: ["ETH", "KEN", "TZA", "UGA", "RWA", "BDI", "SOM", "SSD", "SDN", "MOZ", "MWI", "MDG"] },
  { label: "Africa — Central/South", iso3List: ["COD", "CAF", "AGO", "ZAF", "ZMB", "ZWE", "TCD"] },
  { label: "Middle East & N. Africa", iso3List: ["IRQ", "SYR", "YEM", "LBY", "EGY", "IRN", "ISR", "SAU", "TUR"] },
  { label: "South & SE Asia", iso3List: ["IND", "PAK", "BGD", "MMR", "THA", "IDN", "PHL", "VNM"] },
  { label: "East Asia & Pacific", iso3List: ["CHN", "JPN", "AUS"] },
  { label: "Americas", iso3List: ["USA", "BRA", "MEX", "COL", "VEN", "PER", "GTM", "HTI", "ARG"] },
  { label: "Europe & Central Asia", iso3List: ["GBR", "DEU", "FRA", "RUS", "UKR"] },
];

function riskColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 55) return "bg-orange-500";
  if (score >= 40) return "bg-amber-400";
  if (score >= 25) return "bg-yellow-300";
  return "bg-emerald-400";
}

function riskTextColor(score: number): string {
  if (score >= 55) return "text-white";
  return "text-foreground";
}

export function RiskHeatMap({ onSelectCountry }: Props) {
  const { data: rawData, isLoading } = useQuery({
    queryKey: ["risk-heatmap-data"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("country_performance_snapshots")
        .select("iso3, risk_pressure_score, forecast_direction")
        .eq("snapshot_date", today)
        .order("risk_pressure_score", { ascending: false });
      return data || [];
    },
    staleTime: 60_000,
  });

  const countryRisks = useMemo(() => {
    if (!rawData?.length) return {};
    const map: Record<string, { avgRisk: number; count: number }> = {};
    for (const r of rawData) {
      if (!map[r.iso3]) map[r.iso3] = { avgRisk: 0, count: 0 };
      map[r.iso3].avgRisk += r.risk_pressure_score;
      map[r.iso3].count += 1;
    }
    for (const k of Object.keys(map)) {
      map[k].avgRisk = map[k].avgRisk / map[k].count;
    }
    return map;
  }, [rawData]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" /> Risk Heat Map
          </CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-48 w-full" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          Global Risk Heat Map
          <Badge variant="secondary" className="text-[10px] ml-auto">
            {Object.keys(countryRisks).length} countries
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Legend */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Low</span>
          <div className="flex gap-0.5">
            {[10, 30, 45, 60, 80].map((v) => (
              <div key={v} className={`w-5 h-3 rounded-sm ${riskColor(v)}`} />
            ))}
          </div>
          <span>Critical</span>
        </div>

        {/* Region groups */}
        <div className="space-y-2.5">
          {REGION_GROUPS.map((group) => {
            const countries = group.iso3List
              .filter((iso) => countryRisks[iso])
              .map((iso) => ({ iso3: iso, risk: countryRisks[iso].avgRisk }))
              .sort((a, b) => b.risk - a.risk);

            if (countries.length === 0) return null;

            const avgGroupRisk = countries.reduce((s, c) => s + c.risk, 0) / countries.length;

            return (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">{group.label}</span>
                  <Badge variant="outline" className={`text-[9px] h-4 ${avgGroupRisk > 55 ? "border-red-500/30 text-red-500" : "border-border"}`}>
                    Avg {avgGroupRisk.toFixed(0)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {countries.map((c) => (
                    <button
                      key={c.iso3}
                      onClick={() => onSelectCountry(c.iso3, COUNTRY_NAMES[c.iso3] || c.iso3)}
                      className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-all hover:scale-105 hover:ring-2 hover:ring-primary/30 ${riskColor(c.risk)} ${riskTextColor(c.risk)}`}
                      title={`${COUNTRY_NAMES[c.iso3] || c.iso3}: Risk ${c.risk.toFixed(0)}`}
                    >
                      {c.iso3}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
