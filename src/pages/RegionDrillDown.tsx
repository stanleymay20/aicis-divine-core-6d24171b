import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Users, Building2, Activity, Globe } from "lucide-react";
import { Loader2 } from "lucide-react";

export default function RegionDrillDown() {
  const { id } = useParams<{ id: string }>();

  const { data: region, isLoading } = useQuery({
    queryKey: ["admin-region", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_regions")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: parent } = useQuery({
    queryKey: ["admin-region-parent", region?.parent_id],
    enabled: !!region?.parent_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level")
        .eq("id", region!.parent_id!)
        .maybeSingle();
      return data;
    },
  });

  const { data: children = [] } = useQuery({
    queryKey: ["admin-region-children", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level, urban_rural, population_est")
        .eq("parent_id", id!)
        .order("name")
        .limit(100);
      return data ?? [];
    },
  });

  const { data: indicators = [] } = useQuery({
    queryKey: ["village-indicators", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("village_indicators")
        .select("*")
        .eq("region_id", id!)
        .order("computed_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const { data: communityMetrics = [] } = useQuery({
    queryKey: ["community-metrics", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("community_metrics")
        .select("*")
        .eq("region_id", id!)
        .order("captured_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!region) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Region not found</p>
            <Button asChild variant="link" className="mt-4">
              <Link to="/resolution">Back to atlas</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tierLabel = ["L4 Country", "L3 State/Province", "L2 District", "L1 Sub-district", "L0 Village"][
    region.admin_level
  ] ?? `Level ${region.admin_level}`;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/resolution">
            <ArrowLeft className="h-4 w-4 mr-2" /> Atlas
          </Link>
        </Button>
        {parent && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/atlas/region/${parent.id}`}>
              <ArrowLeft className="h-4 w-4 mr-2" /> {parent.name}
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <MapPin className="h-7 w-7 text-primary" />
                {region.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="outline">{tierLabel}</Badge>
                <Badge variant="outline">{region.country_iso3}</Badge>
                {region.urban_rural && <Badge variant="outline">{region.urban_rural}</Badge>}
                {region.iso_code && <Badge variant="outline">{region.iso_code}</Badge>}
              </div>
            </div>
            <div className="text-right">
              {region.population_est && (
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono">{region.population_est.toLocaleString()}</span>
                </div>
              )}
              {region.area_km2 && (
                <div className="text-xs text-muted-foreground mt-1">
                  {region.area_km2.toLocaleString()} km²
                </div>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-primary" />
              Inferred Village Indicators
              <Badge variant="secondary" className="ml-auto">
                {indicators.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {indicators.length === 0 ? (
              <p className="text-sm text-muted-foreground">No inferred indicators yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {indicators.map((i: any) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between p-2 rounded border bg-muted/30"
                  >
                    <div>
                      <div className="text-sm font-medium">{i.indicator_key}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.domain} · confidence {(i.confidence ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="font-mono text-sm">{Number(i.value).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5 text-primary" />
              Community-Reported Metrics
              <Badge variant="secondary" className="ml-auto">
                {communityMetrics.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {communityMetrics.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No community reports yet. Verified node operators can contribute via the federation API.
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {communityMetrics.map((m: any) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-2 rounded border bg-muted/30"
                  >
                    <div>
                      <div className="text-sm font-medium">{m.indicator_key}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.domain} · {m.source}
                      </div>
                    </div>
                    <div className="font-mono text-sm">
                      {Number(m.value).toFixed(2)} {m.unit ?? ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {children.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary" />
              Sub-Regions
              <Badge variant="secondary" className="ml-auto">
                {children.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {children.map((c: any) => (
                <Link
                  key={c.id}
                  to={`/atlas/region/${c.id}`}
                  className="flex items-center justify-between p-3 rounded border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      L{c.admin_level} {c.urban_rural ? `· ${c.urban_rural}` : ""}
                    </div>
                  </div>
                  {c.population_est && (
                    <div className="text-xs font-mono text-muted-foreground">
                      {(c.population_est / 1000).toFixed(0)}k
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
