import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import "leaflet/dist/leaflet.css";

// Country centroids for global view
const COUNTRY_COORDS: Record<string, [number, number]> = {
  AFG:[33.93,67.71],AGO:[-11.20,17.87],ARG:[-38.42,-63.62],AUS:[-25.27,133.78],
  BDI:[-3.37,29.92],BFA:[12.24,-1.56],BGD:[23.68,90.36],BRA:[-14.24,-51.93],
  CAF:[6.61,20.94],CHN:[35.86,104.20],COD:[-4.04,21.76],COL:[4.57,-74.30],
  CMR:[7.37,12.35],DEU:[51.17,10.45],EGY:[26.82,30.80],ETH:[9.14,40.49],
  FRA:[46.23,2.21],GBR:[55.38,-3.44],GHA:[7.95,-1.02],GMB:[13.44,-15.31],
  GTM:[15.78,-90.23],HTI:[18.97,-72.29],IDN:[-0.79,113.92],IND:[20.59,78.96],
  IRN:[32.43,53.69],IRQ:[33.22,43.68],ISR:[31.05,34.85],JPN:[36.20,138.25],
  KEN:[-0.02,37.91],KIR:[1.87,-157.36],LBY:[26.34,17.23],MDG:[-18.77,46.87],
  MEX:[23.63,-102.55],MLI:[17.57,-4.00],MMR:[21.91,95.96],MOZ:[-18.67,35.53],
  MWI:[-13.25,34.30],NER:[17.61,8.08],NGA:[9.08,8.68],PAK:[30.38,69.35],
  PER:[-9.19,-75.02],PHL:[12.88,121.77],RUS:[61.52,105.32],RWA:[-1.94,29.87],
  SAU:[23.89,45.08],SDN:[12.86,30.22],SEN:[14.50,-14.45],SLV:[13.79,-88.90],
  SOM:[5.15,46.20],SSD:[6.88,31.31],SYR:[34.80,38.99],TCD:[15.45,18.73],
  THA:[15.87,100.99],TUR:[38.96,35.24],TZA:[-6.37,34.89],UGA:[1.37,32.29],
  UKR:[48.38,31.17],USA:[37.09,-95.71],VEN:[6.42,-66.59],VNM:[14.06,108.28],
  YEM:[15.55,48.52],ZAF:[-30.56,22.94],ZMB:[-13.13,27.85],ZWE:[-19.02,29.15],
  ARE:[23.42,53.85],MYS:[4.21,101.98],COG:[-0.23,15.83],GIN:[9.95,-9.70],
  LBR:[6.43,-9.43],SLE:[8.46,-11.78],TGO:[8.62,1.21],BEN:[9.31,2.32],
  DJI:[11.83,42.59],ERI:[15.18,39.78],GAB:[-0.80,11.61],GNQ:[1.65,10.27],
  LSO:[-29.61,28.23],MRT:[21.01,-10.94],NAM:[-22.96,18.49],SWZ:[-26.52,31.47],
  TUN:[33.89,9.54],MAR:[31.79,-7.09],DZA:[28.03,1.66],LKA:[7.87,80.77],
  NPL:[28.39,84.12],KHM:[12.57,104.99],LAO:[19.86,102.50],TWN:[23.70,120.96],
  KOR:[35.91,127.77],PRK:[40.34,127.51],MNG:[46.86,103.85],KAZ:[48.02,66.92],
  UZB:[41.38,64.59],TKM:[38.97,59.56],KGZ:[41.20,74.77],TJK:[38.86,71.28],
  GEO:[42.32,43.36],ARM:[40.07,45.04],AZE:[40.14,47.58],JOR:[30.59,36.24],
  LBN:[33.85,35.86],KWT:[29.31,47.48],BHR:[26.07,50.55],QAT:[25.35,51.18],
  OMN:[21.47,55.98],AFR:[0,25],ECU:[-1.83,-78.18],BOL:[-16.29,-63.59],
  PRY:[-23.44,-58.44],URY:[-32.52,-55.77],CHL:[-35.68,-71.54],CRI:[9.75,-83.75],
  PAN:[8.54,-80.78],HND:[15.20,-86.24],NIC:[12.87,-85.21],CUB:[21.52,-77.78],
  DOM:[18.74,-70.16],JAM:[18.11,-77.30],TTO:[10.69,-61.22],
};

const COUNTRY_NAMES: Record<string, string> = {
  AFG:"Afghanistan",AGO:"Angola",ARG:"Argentina",AUS:"Australia",BDI:"Burundi",
  BFA:"Burkina Faso",BGD:"Bangladesh",BRA:"Brazil",CAF:"Central African Republic",
  CHN:"China",COD:"DR Congo",COL:"Colombia",CMR:"Cameroon",DEU:"Germany",
  EGY:"Egypt",ETH:"Ethiopia",FRA:"France",GBR:"United Kingdom",GHA:"Ghana",
  GMB:"Gambia",GTM:"Guatemala",HTI:"Haiti",IDN:"Indonesia",IND:"India",
  IRN:"Iran",IRQ:"Iraq",ISR:"Israel",JPN:"Japan",KEN:"Kenya",KIR:"Kiribati",
  LBY:"Libya",MDG:"Madagascar",MEX:"Mexico",MLI:"Mali",MMR:"Myanmar",
  MOZ:"Mozambique",MWI:"Malawi",NER:"Niger",NGA:"Nigeria",PAK:"Pakistan",
  PER:"Peru",PHL:"Philippines",RUS:"Russia",RWA:"Rwanda",SAU:"Saudi Arabia",
  SDN:"Sudan",SEN:"Senegal",SLV:"El Salvador",SOM:"Somalia",SSD:"South Sudan",
  SYR:"Syria",TCD:"Chad",THA:"Thailand",TUR:"Turkey",TZA:"Tanzania",
  UGA:"Uganda",UKR:"Ukraine",USA:"United States",VEN:"Venezuela",VNM:"Vietnam",
  YEM:"Yemen",ZAF:"South Africa",ZMB:"Zambia",ZWE:"Zimbabwe",
};

function riskFill(score: number): string {
  if (score >= 70) return "#ef4444";
  if (score >= 55) return "#f97316";
  if (score >= 40) return "#eab308";
  if (score >= 25) return "#facc15";
  return "#22c55e";
}

function riskLabel(score: number): string {
  if (score >= 70) return "Critical";
  if (score >= 55) return "High";
  if (score >= 40) return "Elevated";
  if (score >= 25) return "Moderate";
  return "Low";
}

/* ── Fly-to helper ── */
function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 });
  }, [center[0], center[1], zoom]);
  return null;
}

/* ===================================================================
   GLOBAL MAP  – country-level heat circles
   =================================================================== */
interface GlobalMapProps {
  onSelectCountry: (iso3: string, name: string) => void;
}

export function GlobalRiskMap({ onSelectCountry }: GlobalMapProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["map-global-risk"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("country_performance_snapshots")
        .select("iso3, risk_pressure_score, momentum_score, forecast_direction, domain")
        .eq("snapshot_date", today);
      if (!data?.length) return [];

      const map: Record<string, { iso3: string; totalRisk: number; count: number; domains: string[] }> = {};
      for (const r of data) {
        if (!map[r.iso3]) map[r.iso3] = { iso3: r.iso3, totalRisk: 0, count: 0, domains: [] };
        map[r.iso3].totalRisk += r.risk_pressure_score;
        map[r.iso3].count += 1;
        map[r.iso3].domains.push(r.domain);
      }
      return Object.values(map).map(c => ({
        iso3: c.iso3,
        avgRisk: c.totalRisk / c.count,
        domains: c.count,
        coords: COUNTRY_COORDS[c.iso3] as [number, number] | undefined,
      })).filter(c => c.coords);
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="h-[500px] md:h-[600px] w-full">
          <MapContainer
            center={[20, 10]}
            zoom={2}
            minZoom={2}
            maxZoom={6}
            scrollWheelZoom
            className="h-full w-full z-0"
            style={{ background: "#0f172a" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {data?.map((c) => (
              <CircleMarker
                key={c.iso3}
                center={c.coords!}
                radius={Math.max(6, Math.min(22, c.avgRisk / 3.5))}
                pathOptions={{
                  fillColor: riskFill(c.avgRisk),
                  fillOpacity: 0.75,
                  color: riskFill(c.avgRisk),
                  weight: 1.5,
                  opacity: 0.9,
                }}
                eventHandlers={{
                  click: () => onSelectCountry(c.iso3, COUNTRY_NAMES[c.iso3] || c.iso3),
                }}
              >
                <Popup>
                  <div className="text-sm space-y-1 min-w-[160px]">
                    <p className="font-bold">{COUNTRY_NAMES[c.iso3] || c.iso3}</p>
                    <p>Risk: <strong style={{ color: riskFill(c.avgRisk) }}>{c.avgRisk.toFixed(0)} — {riskLabel(c.avgRisk)}</strong></p>
                    <p className="text-xs text-gray-500">{c.domains} domains tracked</p>
                    <Button size="sm" variant="outline" className="w-full mt-1 text-xs"
                      onClick={() => onSelectCountry(c.iso3, COUNTRY_NAMES[c.iso3] || c.iso3)}>
                      Drill into market →
                    </Button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
            <MapLegend />
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================================================================
   COUNTRY MAP  – region-level circles within a country
   =================================================================== */
interface CountryMapProps {
  iso3: string;
  countryName: string;
  onSelectRegion: (regionId: string, regionName: string) => void;
}

export function CountryRiskMap({ iso3, countryName, onSelectRegion }: CountryMapProps) {
  const center = COUNTRY_COORDS[iso3] || [0, 0];

  const { data: regions, isLoading } = useQuery({
    queryKey: ["map-country-regions", iso3],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level, lat, lon, population_est, urban_rural")
        .eq("country_iso3", iso3)
        .not("lat", "is", null)
        .not("lon", "is", null)
        .in("admin_level", [1, 2])
        .limit(200);
      return data || [];
    },
    staleTime: 60_000,
  });

  // Get village indicator counts per region for heat intensity
  const regionIds = useMemo(() => regions?.map(r => r.id) || [], [regions]);

  const { data: indicatorCounts } = useQuery({
    queryKey: ["map-region-indicator-counts", iso3, regionIds.slice(0, 5).join(",")],
    queryFn: async () => {
      if (!regionIds.length) return {};
      // Get a sample of indicators to derive a pseudo-risk per region
      const { data } = await supabase
        .from("village_indicators")
        .select("region_id, value, confidence, domain")
        .in("region_id", regionIds.slice(0, 100))
        .limit(500);
      if (!data?.length) return {};
      const counts: Record<string, { total: number; avgConf: number; domains: Set<string> }> = {};
      for (const d of data) {
        if (!counts[d.region_id]) counts[d.region_id] = { total: 0, avgConf: 0, domains: new Set() };
        counts[d.region_id].total += 1;
        counts[d.region_id].avgConf += (d.confidence || 0.5);
        counts[d.region_id].domains.add(d.domain);
      }
      const result: Record<string, { count: number; avgConf: number; domainCount: number }> = {};
      for (const [k, v] of Object.entries(counts)) {
        result[k] = { count: v.total, avgConf: v.avgConf / v.total, domainCount: v.domains.size };
      }
      return result;
    },
    enabled: regionIds.length > 0,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-[400px] w-full rounded-xl" />;

  if (!regions?.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <p>No geo-located regions found for {countryName}.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="h-[400px] md:h-[500px] w-full">
          <MapContainer
            center={center}
            zoom={6}
            minZoom={3}
            maxZoom={12}
            scrollWheelZoom
            className="h-full w-full z-0"
            style={{ background: "#0f172a" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <FlyTo center={center} zoom={6} />
            {regions.map((r) => {
              const info = indicatorCounts?.[r.id];
              const hasData = !!info;
              const intensity = hasData ? Math.min(info.count / 5, 1) : 0.3;
              const color = hasData
                ? (info.avgConf < 0.5 ? "#f97316" : info.domainCount >= 3 ? "#eab308" : "#22c55e")
                : "#64748b";

              return (
                <CircleMarker
                  key={r.id}
                  center={[r.lat!, r.lon!]}
                  radius={Math.max(5, Math.min(14, (r.population_est || 50000) / 100000 + 5))}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: 0.35 + intensity * 0.45,
                    color,
                    weight: 1,
                    opacity: 0.8,
                  }}
                  eventHandlers={{
                    click: () => onSelectRegion(r.id, r.name),
                  }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[150px]">
                      <p className="font-bold">{r.name}</p>
                      <p className="text-xs text-gray-500">Level {r.admin_level} · {r.urban_rural || "unknown"}</p>
                      {r.population_est && <p className="text-xs">Pop: {(r.population_est / 1000).toFixed(0)}K</p>}
                      {info && (
                        <>
                          <p className="text-xs">{info.count} indicators · {info.domainCount} domains</p>
                          <p className="text-xs">Avg confidence: {(info.avgConf * 100).toFixed(0)}%</p>
                        </>
                      )}
                      <Button size="sm" variant="outline" className="w-full mt-1 text-xs"
                        onClick={() => onSelectRegion(r.id, r.name)}>
                        Drill into region →
                      </Button>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================================================================
   REGION MAP  – village/settlement-level indicator heat points
   =================================================================== */
interface RegionMapProps {
  regionId: string;
  regionName: string;
  countryIso3: string;
}

export function RegionRiskMap({ regionId, regionName, countryIso3 }: RegionMapProps) {
  const { data: region } = useQuery({
    queryKey: ["map-region-center", regionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("lat, lon")
        .eq("id", regionId)
        .single();
      return data;
    },
  });

  const { data: children, isLoading } = useQuery({
    queryKey: ["map-region-children", regionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("id, name, admin_level, lat, lon, population_est, urban_rural")
        .eq("parent_id", regionId)
        .not("lat", "is", null)
        .not("lon", "is", null)
        .limit(200);
      return data || [];
    },
  });

  // Get indicators for child regions
  const childIds = useMemo(() => children?.map(c => c.id) || [], [children]);

  const { data: childIndicators } = useQuery({
    queryKey: ["map-region-child-indicators", regionId, childIds.length],
    queryFn: async () => {
      if (!childIds.length) return {};
      const { data } = await supabase
        .from("village_indicators")
        .select("region_id, domain, indicator, value, confidence")
        .in("region_id", childIds.slice(0, 100))
        .limit(500);
      if (!data?.length) return {};
      const grouped: Record<string, { domains: Set<string>; count: number; lowConf: number }> = {};
      for (const d of data) {
        if (!grouped[d.region_id]) grouped[d.region_id] = { domains: new Set(), count: 0, lowConf: 0 };
        grouped[d.region_id].domains.add(d.domain);
        grouped[d.region_id].count += 1;
        if ((d.confidence || 0) < 0.5) grouped[d.region_id].lowConf += 1;
      }
      const result: Record<string, { domainCount: number; count: number; lowConf: number }> = {};
      for (const [k, v] of Object.entries(grouped)) {
        result[k] = { domainCount: v.domains.size, count: v.count, lowConf: v.lowConf };
      }
      return result;
    },
    enabled: childIds.length > 0,
    staleTime: 60_000,
  });

  // Also get indicators directly on this region
  const { data: selfIndicators } = useQuery({
    queryKey: ["map-region-self-indicators", regionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("village_indicators")
        .select("domain, indicator, value, confidence")
        .eq("region_id", regionId)
        .limit(100);
      return data || [];
    },
  });

  const center: [number, number] = region?.lat && region?.lon
    ? [region.lat, region.lon]
    : COUNTRY_COORDS[countryIso3] || [0, 0];

  if (isLoading) return <Skeleton className="h-[350px] w-full rounded-xl" />;

  const hasPoints = (children?.length || 0) > 0 || (region?.lat && region?.lon);

  if (!hasPoints) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <p>No geo-located settlements found for {regionName}.</p>
        </CardContent>
      </Card>
    );
  }

  // Domain color coding
  const domainColor = (domainCount: number, lowConf: number, count: number) => {
    if (lowConf > count * 0.5) return "#ef4444"; // many low-confidence = warning
    if (domainCount >= 4) return "#f97316";
    if (domainCount >= 2) return "#eab308";
    return "#22c55e";
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="h-[350px] md:h-[450px] w-full">
          <MapContainer
            center={center}
            zoom={9}
            minZoom={5}
            maxZoom={16}
            scrollWheelZoom
            className="h-full w-full z-0"
            style={{ background: "#0f172a" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <FlyTo center={center} zoom={9} />

            {/* Self marker */}
            {region?.lat && region?.lon && selfIndicators && selfIndicators.length > 0 && (
              <CircleMarker
                center={[region.lat, region.lon]}
                radius={12}
                pathOptions={{ fillColor: "#3b82f6", fillOpacity: 0.6, color: "#3b82f6", weight: 2, opacity: 1 }}
              >
                <Popup>
                  <div className="text-sm space-y-1 min-w-[140px]">
                    <p className="font-bold">{regionName}</p>
                    <p className="text-xs">{selfIndicators.length} indicators</p>
                    <p className="text-xs text-gray-500">
                      Domains: {[...new Set(selfIndicators.map(i => i.domain))].join(", ")}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            )}

            {/* Child settlement markers */}
            {children?.map((c) => {
              const info = childIndicators?.[c.id];
              const col = info
                ? domainColor(info.domainCount, info.lowConf, info.count)
                : "#64748b";

              return (
                <CircleMarker
                  key={c.id}
                  center={[c.lat!, c.lon!]}
                  radius={info ? Math.max(4, Math.min(10, info.count / 3 + 4)) : 4}
                  pathOptions={{
                    fillColor: col,
                    fillOpacity: info ? 0.7 : 0.3,
                    color: col,
                    weight: 1,
                    opacity: 0.8,
                  }}
                >
                  <Popup>
                    <div className="text-sm space-y-1 min-w-[130px]">
                      <p className="font-bold">{c.name}</p>
                      <p className="text-xs text-gray-500">Level {c.admin_level} · {c.urban_rural || ""}</p>
                      {c.population_est && <p className="text-xs">Pop: {c.population_est.toLocaleString()}</p>}
                      {info && (
                        <>
                          <p className="text-xs">{info.count} indicators · {info.domainCount} domains</p>
                          {info.lowConf > 0 && (
                            <p className="text-xs text-orange-500">{info.lowConf} low-confidence readings</p>
                          )}
                        </>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Shared legend overlay ── */
function MapLegend() {
  return (
    <div className="leaflet-bottom leaflet-left" style={{ pointerEvents: "auto" }}>
      <div className="leaflet-control bg-background/90 backdrop-blur rounded-lg p-2 m-2 text-xs space-y-1 border border-border shadow-lg">
        <p className="font-semibold text-foreground text-[11px]">Risk Level</p>
        {[
          { color: "#22c55e", label: "Low (< 25)" },
          { color: "#facc15", label: "Moderate (25–40)" },
          { color: "#eab308", label: "Elevated (40–55)" },
          { color: "#f97316", label: "High (55–70)" },
          { color: "#ef4444", label: "Critical (70+)" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: l.color }} />
            <span className="text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
