import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, X, Globe, RotateCcw, Filter,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { parseMapQuery, MapQuery, ALL_DOMAINS } from "./queryParser";
import { useCountryRiskData, aggregateByCountry, useRelatedSignals, useCountryRegions } from "./useAtlasData";
import { AtlasInsightPanel } from "./AtlasInsightPanel";

/* ── Country coordinates ── */
const CC: Record<string, [number, number]> = {
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
  OMN:[21.47,55.98],ECU:[-1.83,-78.18],BOL:[-16.29,-63.59],
  PRY:[-23.44,-58.44],URY:[-32.52,-55.77],CHL:[-35.68,-71.54],CRI:[9.75,-83.75],
  PAN:[8.54,-80.78],HND:[15.20,-86.24],NIC:[12.87,-85.21],CUB:[21.52,-77.78],
  DOM:[18.74,-70.16],JAM:[18.11,-77.30],TTO:[10.69,-61.22],
  CIV:[7.54,-5.55],BWA:[-22.33,24.68],
};

export const CN: Record<string, string> = {
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
  ARE:"UAE",MYS:"Malaysia",COG:"Congo",GIN:"Guinea",LBR:"Liberia",SLE:"Sierra Leone",
  TGO:"Togo",BEN:"Benin",DJI:"Djibouti",ERI:"Eritrea",GAB:"Gabon",GNQ:"Eq. Guinea",
  LSO:"Lesotho",MRT:"Mauritania",NAM:"Namibia",SWZ:"Eswatini",TUN:"Tunisia",
  MAR:"Morocco",DZA:"Algeria",LKA:"Sri Lanka",NPL:"Nepal",KHM:"Cambodia",
  LAO:"Laos",TWN:"Taiwan",KOR:"South Korea",PRK:"North Korea",MNG:"Mongolia",
  KAZ:"Kazakhstan",UZB:"Uzbekistan",TKM:"Turkmenistan",KGZ:"Kyrgyzstan",
  TJK:"Tajikistan",GEO:"Georgia",ARM:"Armenia",AZE:"Azerbaijan",JOR:"Jordan",
  LBN:"Lebanon",KWT:"Kuwait",BHR:"Bahrain",QAT:"Qatar",OMN:"Oman",
  ECU:"Ecuador",BOL:"Bolivia",PRY:"Paraguay",URY:"Uruguay",CHL:"Chile",
  CRI:"Costa Rica",PAN:"Panama",HND:"Honduras",NIC:"Nicaragua",CUB:"Cuba",
  DOM:"Dominican Republic",JAM:"Jamaica",TTO:"Trinidad & Tobago",
  CIV:"Ivory Coast",BWA:"Botswana",
};

/* ── Continent map centers ── */
const CONTINENT_CENTERS: Record<string, { center: [number, number]; zoom: number }> = {
  africa: { center: [2, 20], zoom: 3 },
  "west africa": { center: [10, -3], zoom: 5 },
  "east africa": { center: [-2, 35], zoom: 5 },
  "north africa": { center: [28, 15], zoom: 4 },
  "central africa": { center: [2, 20], zoom: 5 },
  "southern africa": { center: [-25, 25], zoom: 5 },
  asia: { center: [25, 80], zoom: 3 },
  "southeast asia": { center: [5, 110], zoom: 4 },
  europe: { center: [50, 15], zoom: 4 },
  "south america": { center: [-15, -60], zoom: 3 },
  "central america": { center: [13, -85], zoom: 5 },
  "middle east": { center: [28, 45], zoom: 4 },
};

function riskColor(score: number): string {
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

const DOMAIN_COLORS: Record<string, string> = {
  climate: "#06b6d4", education: "#8b5cf6", energy: "#f59e0b",
  finance: "#10b981", food: "#ef4444", governance: "#6366f1",
  health: "#ec4899", population: "#78716c", security: "#dc2626",
};

const EXAMPLE_QUERIES = [
  "energy risk in Africa",
  "food and climate in Ghana",
  "countries with finance risk above 70",
  "compare Nigeria and Kenya on governance",
  "rising security risk",
  "show health risk in East Africa",
];

export function RiskAtlas() {
  const [queryText, setQueryText] = useState("");
  const [activeQuery, setActiveQuery] = useState<MapQuery | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const defaultQuery = useMemo<MapQuery>(() => ({
    scope: "global", geography: null, domains: [], threshold: null,
    comparison: null, trend: null, viewLevel: "country", raw: "",
  }), []);

  const currentQuery = activeQuery || defaultQuery;
  const { data: riskData, isLoading } = useCountryRiskData(currentQuery);
  const countryAgg = useMemo(() => aggregateByCountry(riskData || []), [riskData]);

  const { data: signals } = useRelatedSignals(
    selectedCountry || (currentQuery.scope === "country" ? currentQuery.geography : null),
    currentQuery.domains
  );

  // Fetch regions when a country is selected for drill-down
  const { data: regions } = useCountryRegions(selectedCountry);

  const handleSearch = useCallback(() => {
    if (!queryText.trim()) {
      setActiveQuery(null);
      setSelectedCountry(null);
      return;
    }
    const parsed = parseMapQuery(queryText);
    setActiveQuery(parsed);
    setSelectedCountry(parsed.scope === "country" ? parsed.geography : null);
    setPanelOpen(true);
  }, [queryText]);

  const handleReset = useCallback(() => {
    setQueryText("");
    setActiveQuery(null);
    setSelectedCountry(null);
    setPanelOpen(false);
  }, []);

  const handleCountryClick = useCallback((iso3: string) => {
    setSelectedCountry(iso3);
    setPanelOpen(true);
  }, []);

  const mapView = useMemo(() => {
    if (currentQuery.scope === "continent" && currentQuery.geography) {
      return CONTINENT_CENTERS[currentQuery.geography] || { center: [20, 0] as [number, number], zoom: 2 };
    }
    if (currentQuery.scope === "country" && currentQuery.geography && CC[currentQuery.geography]) {
      return { center: CC[currentQuery.geography], zoom: 5 };
    }
    if (currentQuery.comparison) {
      const a = CC[currentQuery.comparison.a];
      const b = CC[currentQuery.comparison.b];
      if (a && b) {
        return { center: [(a[0]+b[0])/2, (a[1]+b[1])/2] as [number, number], zoom: 4 };
      }
    }
    // If a country is selected via click, zoom to it
    if (selectedCountry && CC[selectedCountry]) {
      return { center: CC[selectedCountry], zoom: 5 };
    }
    return { center: [20, 10] as [number, number], zoom: 2 };
  }, [currentQuery, selectedCountry]);

  const topCountries = useMemo(() => {
    return Object.values(countryAgg)
      .sort((a, b) => b.avgRisk - a.avgRisk)
      .slice(0, 10);
  }, [countryAgg]);

  const selectedCountryData = selectedCountry ? countryAgg[selectedCountry] : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-background/95 backdrop-blur shrink-0">
        <Globe className="w-5 h-5 text-primary shrink-0" />
        <h1 className="text-lg font-bold text-foreground tracking-tight">AICIS Risk Atlas</h1>
        <div className="flex-1" />
        {activeQuery && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 text-xs">
            <RotateCcw className="w-3 h-3" /> Reset
          </Button>
        )}
      </div>

      {/* Query bar */}
      <div className="px-4 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex gap-2 max-w-3xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder='Try: "energy risk in Africa" or "compare Nigeria and Kenya"'
              className="pl-9 pr-8 h-9 text-sm bg-background"
            />
            {queryText && (
              <button onClick={() => setQueryText("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <Button size="sm" onClick={handleSearch} className="h-9 px-4">
            Search
          </Button>
        </div>
        {/* Domain chips */}
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {ALL_DOMAINS.map(d => {
            const isActive = currentQuery.domains.includes(d);
            return (
              <button
                key={d}
                onClick={() => {
                  const newDomains = isActive
                    ? currentQuery.domains.filter(x => x !== d)
                    : [...currentQuery.domains, d];
                  setActiveQuery({ ...currentQuery, domains: newDomains, raw: queryText });
                  setPanelOpen(true);
                }}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors border ${
                  isActive
                    ? "text-foreground border-primary bg-primary/15"
                    : "text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: DOMAIN_COLORS[d] }} />
                {d}
              </button>
            );
          })}
        </div>
        {/* Example queries */}
        {!activeQuery && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {EXAMPLE_QUERIES.map(eq => (
              <button
                key={eq}
                onClick={() => { setQueryText(eq); }}
                className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 border border-border/50 rounded-md hover:border-primary/30 transition-colors"
              >
                {eq}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active query summary */}
      {activeQuery && (
        <div className="px-4 py-1.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2 text-xs shrink-0">
          <Filter className="w-3 h-3 text-primary" />
          <span className="text-foreground font-medium">Query:</span>
          <span className="text-muted-foreground">"{activeQuery.raw}"</span>
          {activeQuery.geography && (
            <Badge variant="secondary" className="text-[10px] py-0">{activeQuery.geography}</Badge>
          )}
          {activeQuery.domains.map(d => (
            <Badge key={d} variant="outline" className="text-[10px] py-0">{d}</Badge>
          ))}
          {activeQuery.threshold && (
            <Badge variant="destructive" className="text-[10px] py-0">≥{activeQuery.threshold}</Badge>
          )}
          {activeQuery.trend && (
            <Badge variant="outline" className="text-[10px] py-0">{activeQuery.trend}</Badge>
          )}
          {activeQuery.comparison && (
            <Badge variant="secondary" className="text-[10px] py-0">
              {CN[activeQuery.comparison.a] || activeQuery.comparison.a} vs {CN[activeQuery.comparison.b] || activeQuery.comparison.b}
            </Badge>
          )}
          <span className="text-muted-foreground ml-auto">
            {Object.keys(countryAgg).length} countries · {(riskData || []).length} data points
          </span>
        </div>
      )}

      {/* Main content: Map + Panel */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Map */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">Loading risk data…</span>
              </div>
            </div>
          )}
          <AtlasMap
            countries={countryAgg}
            center={mapView.center}
            zoom={mapView.zoom}
            selectedCountry={selectedCountry}
            onCountryClick={handleCountryClick}
            query={currentQuery}
            regions={selectedCountry && regions ? regions : []}
          />
          {/* Legend */}
          <div className="absolute bottom-3 left-3 z-[1000] bg-background/90 backdrop-blur rounded-lg p-2 border border-border shadow-lg text-xs space-y-1">
            <p className="font-semibold text-foreground text-[11px]">Risk Level</p>
            {[
              { color: "#22c55e", label: "Low (< 25)" },
              { color: "#facc15", label: "Moderate (25–40)" },
              { color: "#eab308", label: "Elevated (40–55)" },
              { color: "#f97316", label: "High (55–70)" },
              { color: "#ef4444", label: "Critical (70+)" },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                <span className="text-muted-foreground">{l.label}</span>
              </div>
            ))}
          </div>
          {/* Country count badge */}
          <div className="absolute top-3 right-3 z-[1000]">
            <Badge variant="secondary" className="text-xs">
              {Object.keys(countryAgg).length} countries
            </Badge>
          </div>
        </div>

        {/* Insight Panel */}
        {panelOpen && (
          <AtlasInsightPanel
            query={currentQuery}
            selectedCountry={selectedCountry}
            countryData={selectedCountryData}
            countryName={selectedCountry ? (CN[selectedCountry] || selectedCountry) : null}
            topCountries={topCountries}
            signals={signals || []}
            onClose={() => setPanelOpen(false)}
            onSelectCountry={handleCountryClick}
          />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   AtlasMap – Leaflet map with dynamic markers + region drill-down
   ════════════════════════════════════════════ */

interface RegionRow {
  id: string;
  name: string;
  admin_level: number;
  lat: number | null;
  lon: number | null;
  population_est: number | null;
  urban_rural: string | null;
}

interface AtlasMapProps {
  countries: Record<string, { iso3: string; avgRisk: number; maxRisk: number; domains: number; direction: string }>;
  center: [number, number];
  zoom: number;
  selectedCountry: string | null;
  onCountryClick: (iso3: string) => void;
  query: MapQuery;
  regions: RegionRow[];
}

function AtlasMap({ countries, center, zoom, selectedCountry, onCountryClick, query, regions }: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Layer[]>([]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center, zoom, scrollWheelZoom: true, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '© CARTO', maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;

    const timer = setTimeout(() => map.invalidateSize(), 200);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => { clearTimeout(timer); observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  // Fly to center
  useEffect(() => {
    mapRef.current?.flyTo(center, zoom, { duration: 1.2 });
  }, [center[0], center[1], zoom]);

  // Render country markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // --- Country-level markers ---
    for (const c of Object.values(countries)) {
      const coords = CC[c.iso3];
      if (!coords) continue;

      const color = riskColor(c.avgRisk);
      const radius = Math.max(6, Math.min(24, c.avgRisk / 3));
      const isSelected = c.iso3 === selectedCountry;
      const name = CN[c.iso3] || c.iso3;

      const marker = L.circleMarker(coords, {
        radius: isSelected ? radius + 4 : radius,
        fillColor: color,
        fillOpacity: isSelected ? 0.9 : 0.7,
        color: isSelected ? "#fff" : color,
        weight: isSelected ? 3 : 1.5,
        opacity: 0.9,
      }).addTo(map);

      // Direction arrow indicator
      const dirIcon = c.direction === "up" ? "↑ Rising" : c.direction === "down" ? "↓ Falling" : "— Stable";
      const dirColor = c.direction === "up" ? "#ef4444" : c.direction === "down" ? "#22c55e" : "#94a3b8";

      marker.bindPopup(`
        <div style="min-width:200px;font-family:system-ui;color:#e2e8f0">
          <div style="font-weight:700;font-size:14px;margin-bottom:6px">${name}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color}"></span>
            <span style="font-weight:600;color:${color}">${c.avgRisk.toFixed(0)} – ${riskLabel(c.avgRisk)}</span>
          </div>
          <div style="color:${dirColor};font-size:12px;margin-bottom:4px">${dirIcon}</div>
          <div style="color:#94a3b8;font-size:12px">${c.domains} domain${c.domains !== 1 ? 's' : ''} tracked</div>
          <div style="margin-top:6px;font-size:11px;color:#60a5fa;cursor:pointer" onclick="window.__atlasClick && window.__atlasClick('${c.iso3}')">
            Click to drill down →
          </div>
        </div>
      `, { className: "atlas-popup" });

      marker.on("click", () => onCountryClick(c.iso3));
      markersRef.current.push(marker);

      // Trend arrow overlay for selected countries when trend query is active
      if (query.trend && c.direction === (query.trend === "rising" ? "up" : "down")) {
        const arrow = query.trend === "rising" ? "▲" : "▼";
        const arrowColor = query.trend === "rising" ? "#ef4444" : "#22c55e";
        const icon = L.divIcon({
          html: `<div style="color:${arrowColor};font-size:14px;font-weight:bold;text-shadow:0 1px 3px rgba(0,0,0,0.8)">${arrow}</div>`,
          className: "",
          iconSize: [14, 14],
          iconAnchor: [7, -8],
        });
        const arrowMarker = L.marker(coords, { icon, interactive: false }).addTo(map);
        markersRef.current.push(arrowMarker);
      }
    }

    // --- Region-level markers (meso drill-down) ---
    if (selectedCountry && regions.length > 0) {
      for (const r of regions) {
        if (!r.lat || !r.lon) continue;
        const regionMarker = L.circleMarker([r.lat, r.lon], {
          radius: 4,
          fillColor: "#60a5fa",
          fillOpacity: 0.6,
          color: "#3b82f6",
          weight: 1,
          opacity: 0.8,
        }).addTo(map);

        const popText = r.urban_rural === "urban" ? "🏙 Urban" : r.urban_rural === "rural" ? "🌾 Rural" : "";
        const popEst = r.population_est ? `Pop: ${(r.population_est / 1000).toFixed(0)}k` : "";

        regionMarker.bindPopup(`
          <div style="font-family:system-ui;color:#e2e8f0;min-width:150px">
            <div style="font-weight:600;font-size:13px">${r.name}</div>
            <div style="color:#94a3b8;font-size:11px">Admin level ${r.admin_level} ${popText}</div>
            ${popEst ? `<div style="color:#94a3b8;font-size:11px">${popEst}</div>` : ""}
          </div>
        `, { className: "atlas-popup" });

        markersRef.current.push(regionMarker);
      }
    }

    // --- Comparison highlight ---
    if (query.comparison) {
      const aCoords = CC[query.comparison.a];
      const bCoords = CC[query.comparison.b];
      if (aCoords && bCoords) {
        // Draw a dashed line connecting compared countries
        const line = L.polyline([aCoords, bCoords], {
          color: "#60a5fa",
          weight: 2,
          dashArray: "8 4",
          opacity: 0.6,
        }).addTo(map);
        markersRef.current.push(line);

        // Label markers
        [{ coords: aCoords, iso: query.comparison.a }, { coords: bCoords, iso: query.comparison.b }].forEach(({ coords, iso }) => {
          const name = CN[iso] || iso;
          const icon = L.divIcon({
            html: `<div style="background:rgba(37,99,235,0.85);color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap">${name}</div>`,
            className: "",
            iconAnchor: [0, -20],
          });
          const label = L.marker(coords, { icon, interactive: false }).addTo(map);
          markersRef.current.push(label);
        });
      }
    }
  }, [countries, selectedCountry, onCountryClick, query, regions]);

  // Expose click handler for popups
  useEffect(() => {
    (window as any).__atlasClick = onCountryClick;
    return () => { delete (window as any).__atlasClick; };
  }, [onCountryClick]);

  return <div ref={containerRef} className="h-full w-full bg-[hsl(var(--background))]" />;
}
