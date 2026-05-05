/**
 * PlanetaryPulseMap — animated Leaflet world map showing live signal arrivals.
 * - Initial fetch: last 60 minutes of global_signals with affected_countries.
 * - Realtime: postgres_changes pulses a glowing dot at the country centroid.
 * - Dots fade out over 60s; new ones replace them. Feels alive.
 */
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

// Centroid lookup — extends the Risk Atlas set with the most-active markets.
const CENTROIDS: Record<string, [number, number]> = {
  USA:[37.09,-95.71],CAN:[56.13,-106.35],MEX:[23.63,-102.55],BRA:[-14.24,-51.93],
  ARG:[-38.42,-63.62],CHL:[-35.68,-71.54],COL:[4.57,-74.30],PER:[-9.19,-75.02],
  VEN:[6.42,-66.59],ECU:[-1.83,-78.18],BOL:[-16.29,-63.59],PRY:[-23.44,-58.44],
  URY:[-32.52,-55.77],GBR:[55.38,-3.44],FRA:[46.23,2.21],DEU:[51.17,10.45],
  ESP:[40.46,-3.74],ITA:[41.87,12.57],PRT:[39.40,-8.22],NLD:[52.13,5.29],
  BEL:[50.50,4.47],CHE:[46.82,8.23],AUT:[47.52,14.55],POL:[51.92,19.15],
  SWE:[60.13,18.64],NOR:[60.47,8.47],FIN:[61.92,25.75],DNK:[56.26,9.50],
  IRL:[53.41,-8.24],GRC:[39.07,21.82],TUR:[38.96,35.24],UKR:[48.38,31.17],
  RUS:[61.52,105.32],BLR:[53.71,27.95],ROU:[45.94,24.97],HUN:[47.16,19.50],
  CZE:[49.82,15.47],BGR:[42.73,25.49],HRV:[45.10,15.20],SRB:[44.02,21.01],
  CHN:[35.86,104.20],JPN:[36.20,138.25],KOR:[35.91,127.77],PRK:[40.34,127.51],
  TWN:[23.70,120.96],HKG:[22.32,114.17],MNG:[46.86,103.85],IND:[20.59,78.96],
  PAK:[30.38,69.35],BGD:[23.68,90.36],LKA:[7.87,80.77],NPL:[28.39,84.12],
  MMR:[21.91,95.96],THA:[15.87,100.99],VNM:[14.06,108.28],KHM:[12.57,104.99],
  LAO:[19.86,102.50],MYS:[4.21,101.98],SGP:[1.35,103.82],IDN:[-0.79,113.92],
  PHL:[12.88,121.77],AUS:[-25.27,133.78],NZL:[-40.90,174.89],PNG:[-6.31,143.96],
  AFG:[33.93,67.71],IRN:[32.43,53.69],IRQ:[33.22,43.68],SYR:[34.80,38.99],
  LBN:[33.85,35.86],ISR:[31.05,34.85],JOR:[30.59,36.24],SAU:[23.89,45.08],
  YEM:[15.55,48.52],OMN:[21.47,55.98],ARE:[23.42,53.85],QAT:[25.35,51.18],
  BHR:[26.07,50.55],KWT:[29.31,47.48],EGY:[26.82,30.80],LBY:[26.34,17.23],
  TUN:[33.89,9.54],DZA:[28.03,1.66],MAR:[31.79,-7.09],SDN:[12.86,30.22],
  SSD:[6.88,31.31],ETH:[9.14,40.49],SOM:[5.15,46.20],KEN:[-0.02,37.91],
  UGA:[1.37,32.29],TZA:[-6.37,34.89],RWA:[-1.94,29.87],BDI:[-3.37,29.92],
  COD:[-4.04,21.76],COG:[-0.23,15.83],GAB:[-0.80,11.61],CMR:[7.37,12.35],
  CAF:[6.61,20.94],TCD:[15.45,18.73],NER:[17.61,8.08],NGA:[9.08,8.68],
  BEN:[9.31,2.32],TGO:[8.62,1.21],GHA:[7.95,-1.02],CIV:[7.54,-5.55],
  BFA:[12.24,-1.56],MLI:[17.57,-4.00],SEN:[14.50,-14.45],GMB:[13.44,-15.31],
  GNB:[11.80,-15.18],GIN:[9.95,-9.70],SLE:[8.46,-11.78],LBR:[6.43,-9.43],
  MRT:[21.01,-10.94],ZAF:[-30.56,22.94],NAM:[-22.96,18.49],BWA:[-22.33,24.68],
  ZWE:[-19.02,29.15],ZMB:[-13.13,27.85],MOZ:[-18.67,35.53],MWI:[-13.25,34.30],
  MDG:[-18.77,46.87],AGO:[-11.20,17.87],KAZ:[48.02,66.92],UZB:[41.38,64.59],
  TKM:[38.97,59.56],KGZ:[41.20,74.77],TJK:[38.86,71.28],GEO:[42.32,43.36],
  ARM:[40.07,45.04],AZE:[40.14,47.58],HTI:[18.97,-72.29],DOM:[18.74,-70.16],
  CUB:[21.52,-77.78],JAM:[18.11,-77.30],TTO:[10.69,-61.22],CRI:[9.75,-83.75],
  PAN:[8.54,-80.78],HND:[15.20,-86.24],NIC:[12.87,-85.21],GTM:[15.78,-90.23],
  SLV:[13.79,-88.90],
};

type Pulse = { id: string; iso3: string; ingestion_source: string | null; first_detected_at: string };

export function PlanetaryPulseMap({ height = 380 }: { height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const initial = useQuery({
    queryKey: ["pulse-map-initial"],
    queryFn: async (): Promise<Pulse[]> => {
      const since = new Date(Date.now() - 60 * 60_000).toISOString();
      const { data } = await supabase
        .from("global_signals")
        .select("id, ingestion_source, first_detected_at, affected_countries")
        .gte("first_detected_at", since)
        .order("first_detected_at", { ascending: false })
        .limit(120);
      const out: Pulse[] = [];
      for (const r of data ?? []) {
        for (const c of r.affected_countries ?? []) {
          if (CENTROIDS[c]) {
            out.push({ id: r.id + "::" + c, iso3: c, ingestion_source: r.ingestion_source, first_detected_at: r.first_detected_at });
          }
        }
      }
      return out;
    },
    staleTime: 30_000,
  });

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [15, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 5,
      worldCopyJump: true,
      attributionControl: false,
      zoomControl: false,
      scrollWheelZoom: false,
      dragging: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  const pulse = (iso3: string, source: string | null) => {
    const layer = layerRef.current;
    if (!layer) return;
    const c = CENTROIDS[iso3];
    if (!c) return;
    const color =
      source === "usgs_firehose" ? "#fb923c" :
      source === "reliefweb_firehose" ? "#f87171" :
      source === "gdelt_firehose" ? "#a78bfa" :
      source === "detection_audit_recovery" ? "#fbbf24" :
      source === "firecrawl_search" ? "#c084fc" :
      "#34d399";
    const dot = L.circleMarker(c, {
      radius: 4, color, weight: 2, fillColor: color, fillOpacity: 0.9,
    }).addTo(layer);
    const halo = L.circleMarker(c, {
      radius: 4, color, weight: 2, fillColor: color, fillOpacity: 0.3,
    }).addTo(layer);
    let r = 4;
    let opacity = 0.9;
    const t = setInterval(() => {
      r += 1.2;
      opacity -= 0.05;
      halo.setRadius(r);
      halo.setStyle({ opacity, fillOpacity: opacity * 0.3 });
      if (opacity <= 0) {
        clearInterval(t);
        layer.removeLayer(halo);
      }
    }, 80);
    setTimeout(() => { try { layer.removeLayer(dot); } catch {} }, 60_000);
  };

  // Seed with initial pulses (staggered for visual effect)
  useEffect(() => {
    if (!initial.data || !layerRef.current) return;
    const items = initial.data.slice(0, 60);
    items.forEach((p, i) => setTimeout(() => pulse(p.iso3, p.ingestion_source), i * 80));
  }, [initial.data]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("pulse-map-stream")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "global_signals" },
        (payload) => {
          const row: any = payload.new;
          const countries: string[] = row?.affected_countries ?? [];
          for (const c of countries) pulse(c, row?.ingestion_source ?? null);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div className="relative rounded-xl overflow-hidden border border-border bg-[#0a0e1a]" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-3 left-3 z-[1000] bg-background/80 backdrop-blur-sm rounded-md px-3 py-2 text-[10px] font-mono space-y-1 pointer-events-none">
        <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> live planetary nervous system</div>
        <div className="text-muted-foreground">last 60 min · realtime</div>
      </div>
      <div className="absolute bottom-2 right-2 z-[1000] flex items-center gap-2 text-[9px] font-mono text-muted-foreground bg-background/70 rounded px-2 py-1">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> GDELT</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" /> ReliefWeb</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-orange-400" /> USGS</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-purple-400" /> Web</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Recovered</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Wire</span>
      </div>
    </div>
  );
}

export default PlanetaryPulseMap;
