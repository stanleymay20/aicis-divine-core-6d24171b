import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MapPin, Activity, Thermometer, Heart, Building, Leaf, TrendingUp, AlertTriangle } from "lucide-react";

interface Props {
  regionId: string;
  regionName: string;
  countryIso3: string;
  onBack: () => void;
}

const DOMAIN_ICONS: Record<string, any> = {
  health: Heart,
  economy: TrendingUp,
  infrastructure: Building,
  environment: Leaf,
};

export const RegionDrilldown = ({ regionId, regionName, countryIso3, onBack }: Props) => {
  // Region details
  const { data: region } = useQuery({
    queryKey: ["resolution-region-detail", regionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("*")
        .eq("id", regionId)
        .single();
      return data;
    },
  });

  // Child regions (villages/settlements)
  const { data: children, isLoading: childrenLoading } = useQuery({
    queryKey: ["resolution-region-children", regionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level, population_est, urban_rural, lat, lon")
        .eq("parent_id", regionId)
        .order("name")
        .limit(50);
      return data || [];
    },
  });

  // Village indicators for this region
  const { data: indicators, isLoading: indicatorsLoading } = useQuery({
    queryKey: ["resolution-region-indicators", regionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("village_indicators")
        .select("domain, indicator, value, unit, confidence, data_source, observed_at")
        .eq("region_id", regionId)
        .order("domain")
        .order("observed_at", { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  // Group indicators by domain
  const domainGroups = indicators?.reduce((acc, ind) => {
    if (!acc[ind.domain]) acc[ind.domain] = [];
    acc[ind.domain].push(ind);
    return acc;
  }, {} as Record<string, typeof indicators>) || {};

  // Propagation insight
  const highRiskIndicators = indicators?.filter((i) => i.value !== null && i.confidence && i.confidence < 0.5) || [];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to {countryIso3}
      </Button>

      {/* Region header */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-amber-500" />
                <h2 className="text-lg font-bold text-foreground">{regionName}</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Admin Level {region?.admin_level || "—"} · {region?.urban_rural || "Unknown"} · {countryIso3}
              </p>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Population</p>
                <p className="text-lg font-bold text-foreground">
                  {region?.population_est ? `${(region.population_est / 1000).toFixed(0)}K` : "—"}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Sub-regions</p>
                <p className="text-lg font-bold text-foreground">{children?.length || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Indicators</p>
                <p className="text-lg font-bold text-emerald-500">{indicators?.length || 0}</p>
              </div>
            </div>
          </div>
          {region?.lat && region?.lon && (
            <p className="text-[10px] text-muted-foreground mt-2 font-mono">
              📍 {region.lat.toFixed(4)}, {region.lon.toFixed(4)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Propagation alert if risks detected */}
      {highRiskIndicators.length > 0 && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Impact Propagation Alert</p>
              <p className="text-xs text-muted-foreground mt-1">
                {highRiskIndicators.length} low-confidence indicators detected at village level.
                These micro-signals may propagate to regional and national risk within 2–4 weeks.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Village indicators by domain */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500" />
            Micro — Village-Level Indicators
            <Badge variant="secondary" className="text-[10px] ml-auto">
              {Object.keys(domainGroups).length} domains
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {indicatorsLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : Object.keys(domainGroups).length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Thermometer className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p>No village indicators available for this region yet.</p>
              <p className="text-xs mt-1">Satellite + AI inference pipeline will populate data on next cycle.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(domainGroups).map(([domain, inds]) => {
                const DomainIcon = DOMAIN_ICONS[domain] || Activity;
                return (
                  <div key={domain}>
                    <div className="flex items-center gap-2 mb-2">
                      <DomainIcon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold capitalize">{domain}</span>
                      <Badge variant="outline" className="text-[10px]">{inds.length} indicators</Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {inds.slice(0, 6).map((ind, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded border border-border/50 bg-muted/30">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{ind.indicator}</p>
                            <p className="text-[10px] text-muted-foreground">{ind.data_source}</p>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <p className="text-sm font-bold text-foreground">
                              {typeof ind.value === "number" ? ind.value.toFixed(1) : "—"}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{ind.unit}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Child settlements */}
      {children && children.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-500" />
              Settlements & Villages
              <Badge variant="secondary" className="text-[10px] ml-auto">{children.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
              {children.map((child) => (
                <div key={child.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-emerald-500/50" />
                    <span className="text-sm">{child.name}</span>
                    <Badge variant="outline" className="text-[10px]">L{child.admin_level}</Badge>
                  </div>
                  {child.population_est && (
                    <span className="text-xs text-muted-foreground">{child.population_est.toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
