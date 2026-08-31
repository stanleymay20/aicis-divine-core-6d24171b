import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Crosshair,
  Globe,
  Layers,
  Loader2,
  Network,
  RotateCcw,
  Satellite,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ALL_COUNTRIES, getCountryCoordinates, type Country } from "@/lib/geo/all-countries";
import { cn } from "@/lib/utils";
import { useIncidentMarkers } from "./IncidentMarkers";
import { QuickActions } from "./QuickActions";
import { useNetworkMapLayer } from "./useNetworkMapLayer";

interface CountryData {
  country: string;
  iso3: string;
  latitude: number;
  longitude: number;
  overall_score?: number;
}

export interface GlobalMapRef {
  flyToCountry: (country: Country) => void;
  resetView: () => void;
  spinGlobe: () => void;
  getMap: () => maplibregl.Map | null;
}

interface GlobalMapProps {
  onCountrySelect?: (country: CountryData) => void;
  className?: string;
  isMobile?: boolean;
  showSelectionOverlay?: boolean;
  showQuickActions?: boolean;
  showLegend?: boolean;
  showStatusBadge?: boolean;
  compactControls?: boolean;
}

export const GlobalMap = forwardRef<GlobalMapRef, GlobalMapProps>(
  (
    {
      onCountrySelect,
      className,
      isMobile,
      showSelectionOverlay = true,
      showQuickActions = true,
      showLegend = true,
      showStatusBadge = true,
      compactControls = false,
    },
    ref,
  ) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [countryData, setCountryData] = useState<CountryData[]>([]);
    const [isSpinning, setIsSpinning] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<CountryData | null>(null);
    const [activeLayer, setActiveLayer] = useState("vulnerability");
    const [showSatellite, setShowSatellite] = useState(true);
    const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { incidentCount } = useIncidentMarkers({
      map: map.current,
      isMapLoaded: mapLoaded,
      onIncidentClick: (incident) => {
        const selected: CountryData = {
          country: incident.country || "Unknown",
          iso3: "",
          latitude: incident.latitude,
          longitude: incident.longitude,
          overall_score: incident.severity,
        };
        setSelectedCountry(selected);
        onCountrySelect?.(selected);
      },
    });

    const networkLayer = useNetworkMapLayer({
      map: map.current,
      isMapLoaded: mapLoaded,
      enabled: activeLayer === "networks",
      selectedIso3: selectedCountry?.iso3,
    });

    useEffect(() => {
      const fetchData = async () => {
        const { data } = await supabase
          .from("vulnerability_scores")
          .select("country, iso_code, latitude, longitude, overall_score")
          .order("calculated_at", { ascending: false });

        if (!data) return;

        const latestByCountry = data.reduce((acc: Record<string, CountryData>, curr) => {
          if (
            !acc[curr.country] &&
            Number.isFinite(curr.latitude) &&
            Number.isFinite(curr.longitude)
          ) {
            acc[curr.country] = {
              country: curr.country,
              iso3: curr.iso_code || "",
              latitude: Number(curr.latitude),
              longitude: Number(curr.longitude),
              overall_score: curr.overall_score ?? undefined,
            };
          }
          return acc;
        }, {});
        setCountryData(Object.values(latestByCountry));
      };
      void fetchData();
    }, []);

    useEffect(() => {
      if (!mapContainer.current || map.current) return;

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            satellite: {
              type: "raster",
              tiles: [
                "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              ],
              tileSize: 256,
              attribution: "Esri, Maxar, Earthstar Geographics",
            },
          },
          layers: [
            {
              id: "satellite",
              type: "raster",
              source: "satellite",
              minzoom: 0,
              maxzoom: 19,
            },
          ],
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        },
        center: [0, 20],
        zoom: 2,
        pitch: 0,
        bearing: 0,
        maxZoom: 18,
        minZoom: 1,
      });

      map.current.on("load", () => {
        setMapLoaded(true);
      });

      return () => {
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
        map.current?.remove();
        map.current = null;
      };
    }, []);

    useEffect(() => {
      if (!map.current || !mapLoaded || !map.current.getLayer("satellite")) return;
      map.current.setLayoutProperty("satellite", "visibility", showSatellite ? "visible" : "none");
    }, [mapLoaded, showSatellite]);

    useEffect(() => {
      if (!map.current || !mapLoaded || countryData.length === 0) return;

      document.querySelectorAll(".country-marker").forEach((marker) => marker.remove());

      countryData.forEach((data) => {
        if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) return;

        const score = data.overall_score ?? 0;
        const color =
          score >= 71
            ? "hsl(0 84% 60%)"
            : score >= 51
              ? "hsl(38 92% 50%)"
              : score >= 31
                ? "hsl(45 93% 58%)"
                : "hsl(142 76% 45%)";

        const el = document.createElement("div");
        el.className = "country-marker";
        const size = 12 + score / 8;
        el.style.cssText = `
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.8);
          box-shadow: 0 0 12px ${color};
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        `;

        el.addEventListener("mouseenter", () => {
          el.style.transform = "scale(1.4)";
          el.style.boxShadow = `0 0 24px ${color}`;
        });

        el.addEventListener("mouseleave", () => {
          el.style.transform = "scale(1)";
          el.style.boxShadow = `0 0 12px ${color}`;
        });

        el.addEventListener("click", () => {
          setSelectedCountry(data);
          onCountrySelect?.(data);
          map.current?.flyTo({
            center: [data.longitude, data.latitude],
            zoom: 5,
            duration: 2000,
            essential: true,
          });
        });

        new maplibregl.Marker({ element: el })
          .setLngLat([data.longitude, data.latitude])
          .addTo(map.current!);
      });
    }, [countryData, mapLoaded, onCountrySelect]);

    const flyToLocation = useCallback((lng: number, lat: number, zoom = 5) => {
      if (!map.current) return;
      map.current.flyTo({
        center: [lng, lat],
        zoom,
        duration: 2000,
        essential: true,
      });
    }, []);

    const spinGlobe = useCallback(() => {
      if (!map.current || isSpinning) return;

      setIsSpinning(true);
      map.current.flyTo({ center: [0, 20], zoom: 1.5, duration: 1000 });

      let rotation = 0;
      spinIntervalRef.current = setInterval(() => {
        rotation += 20;
        if (map.current) {
          map.current.setBearing(rotation % 360);
        }
      }, 50);

      setTimeout(() => {
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
        if (map.current) map.current.setBearing(0);
        setIsSpinning(false);
      }, 2500);
    }, [isSpinning]);

    const resetView = useCallback(() => {
      if (!map.current) return;
      map.current.flyTo({
        center: [0, 20],
        zoom: 2,
        bearing: 0,
        pitch: 0,
        duration: 1500,
      });
      setSelectedCountry(null);
    }, []);

    const flyToCountry = useCallback(
      (country: Country) => {
        const coords = getCountryCoordinates(country.iso2);
        if (!coords) return;

        spinGlobe();
        setTimeout(() => {
          flyToLocation(coords.lng, coords.lat, 5);
          const vulnData = countryData.find((candidate) =>
            candidate.country.toLowerCase().includes(country.name.toLowerCase()),
          );
          const data: CountryData = {
            country: country.name,
            iso3: country.iso3,
            latitude: coords.lat,
            longitude: coords.lng,
            ...vulnData,
          };
          setSelectedCountry(data);
          onCountrySelect?.(data);
        }, 2500);
      },
      [countryData, flyToLocation, onCountrySelect, spinGlobe],
    );

    useImperativeHandle(ref, () => ({
      flyToCountry,
      resetView,
      spinGlobe,
      getMap: () => map.current,
    }));

    return (
      <div className={cn("relative h-full w-full", className)}>
        <div ref={mapContainer} className="absolute inset-0" />

        {isSpinning && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <Globe
                className="h-16 w-16 animate-spin text-primary"
                style={{ animationDuration: "0.8s" }}
              />
              <span className="text-sm font-orbitron text-primary animate-pulse">
                Scanning globe...
              </span>
            </div>
          </div>
        )}

        <div
          className={cn(
            "absolute z-20 flex flex-col gap-1",
            isMobile
              ? "bottom-20 right-2"
              : compactControls
                ? "bottom-3 left-3"
                : "bottom-28 left-4",
          )}
        >
          <Button
            variant="secondary"
            size="icon"
            className={cn("border border-primary/20 bg-card/90 backdrop-blur-sm", compactControls ? "h-8 w-8" : "h-9 w-9")}
            onClick={() => map.current?.zoomIn()}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className={cn("border border-primary/20 bg-card/90 backdrop-blur-sm", compactControls ? "h-8 w-8" : "h-9 w-9")}
            onClick={() => map.current?.zoomOut()}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className={cn("border border-primary/20 bg-card/90 backdrop-blur-sm", compactControls ? "h-8 w-8" : "h-9 w-9")}
            onClick={resetView}
            aria-label="Reset map view"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant={activeLayer === "networks" ? "default" : "secondary"}
            size="icon"
            className={cn("border border-primary/20 bg-card/90 backdrop-blur-sm", compactControls ? "h-8 w-8" : "h-9 w-9")}
            onClick={() =>
              setActiveLayer((layer) => (layer === "networks" ? "vulnerability" : "networks"))
            }
            aria-label="Toggle measured network layer"
          >
            <Network className="h-4 w-4" />
          </Button>
          {!isMobile && (
            <>
              <div className="my-1 h-px w-full bg-border" />
              <Button
                variant={showSatellite ? "default" : "secondary"}
                size="icon"
                className={cn("border border-primary/20 bg-card/90 backdrop-blur-sm", compactControls ? "h-8 w-8" : "h-9 w-9")}
                onClick={() => setShowSatellite((visible) => !visible)}
                aria-label="Toggle satellite imagery"
              >
                <Satellite className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>

        {!isMobile && showQuickActions && (
          <div className="absolute left-4 top-20 z-20 max-w-[340px] rounded-lg border border-primary/20 bg-card/90 p-2 backdrop-blur-sm">
            <QuickActions
              activeLayer={activeLayer}
              onAction={(action) => {
                if (action.startsWith("layer:")) {
                  setActiveLayer(action.replace("layer:", ""));
                } else if (action === "global-scan") {
                  spinGlobe();
                }
              }}
            />
          </div>
        )}

        {isMobile && activeLayer === "networks" && !selectedCountry && (
          <div className="absolute left-3 top-3 z-20">
            <Badge variant="secondary" className="gap-1.5 border-primary/20 bg-card/90 backdrop-blur-sm">
              {networkLayer.loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Network className="h-3 w-3 text-primary" />
              )}
              {networkLayer.error
                ? "Network unavailable"
                : `${networkLayer.projectedEdges} measured links`}
            </Badge>
          </div>
        )}

        {!isMobile && showLegend && (
          <div className={cn(
            "absolute right-4 z-20 w-64 rounded-lg border border-primary/20 bg-card/90 p-3 backdrop-blur-sm",
            compactControls ? "bottom-3" : "bottom-28",
          )}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Layers className="h-3 w-3 text-primary" />
              {activeLayer === "networks" ? "Network layer" : "Vulnerability layer"}
            </div>

            {activeLayer === "networks" ? (
              <div className="space-y-2 text-[10px] text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Network className="h-3 w-3 text-primary" />
                    Displayed network sample
                  </span>
                  {networkLayer.loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="font-mono text-foreground">
                      {networkLayer.projectedEdges}/{networkLayer.totalMeasuredEdges}
                    </span>
                  )}
                </div>
                {networkLayer.error && (
                  <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                    {networkLayer.error}
                  </div>
                )}
                {!networkLayer.error && !networkLayer.loading && networkLayer.projectedEdges === 0 && (
                  <div className="rounded border border-border p-2">
                    No sampled measured entity relationships are currently projectable geographically.
                  </div>
                )}
                <div className="space-y-1.5 border-t border-border pt-1">
                  {[
                    { color: "bg-amber-500", label: "Borders" },
                    { color: "bg-violet-400", label: "Trade" },
                    { color: "bg-sky-400", label: "Membership" },
                    { color: "bg-emerald-400", label: "Headquarters" },
                    { color: "bg-slate-400", label: "Parent" },
                    { color: "bg-cyan-400", label: "Selected-country connection" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div className={cn("h-0.5 w-8", color)} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full border border-slate-900 bg-slate-100" />
                  <span>Destination; faded = country-level placement</span>
                </div>
                {selectedCountry?.iso3 && (
                  <div className="flex justify-between gap-2 border-t border-border pt-1">
                    <span>{selectedCountry.country} connections</span>
                    <span className="font-mono text-foreground">{networkLayer.selectedConnections}</span>
                  </div>
                )}
                <p className="leading-relaxed">
                  A balanced visual sample is shown so one relationship family cannot dominate the map. Width reflects current decayed weight; opacity reflects recorded confidence. Click a line for evidence. Relationship does not imply causation.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Vulnerability score
                </div>
                {[
                  { color: "hsl(142 76% 45%)", label: "Low (0-30)" },
                  { color: "hsl(45 93% 58%)", label: "Medium (31-50)" },
                  { color: "hsl(38 92% 50%)", label: "High (51-70)" },
                  { color: "hsl(0 84% 60%)", label: "Critical (71+)" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ background: color }} />
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                  </div>
                ))}
                <div className="my-2 h-px w-full bg-border" />
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Incidents
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 animate-pulse rounded-full bg-destructive" />
                  <span className="text-[10px] text-muted-foreground">Live ({incidentCount})</span>
                </div>
              </div>
            )}
          </div>
        )}

        {showSelectionOverlay && selectedCountry && !isSpinning && (
          <div className={cn(
            "absolute right-4 top-4 z-20 w-72 animate-fade-in rounded-lg border border-primary/20 bg-card/95 p-4 backdrop-blur-sm",
            isMobile && "max-w-[calc(100%-2rem)]",
          )}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-orbitron font-bold">{selectedCountry.country}</h3>
              {selectedCountry.iso3 && <Badge>{selectedCountry.iso3}</Badge>}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Coordinates</span>
                <span className="font-mono text-xs">
                  {selectedCountry.latitude.toFixed(2)}, {selectedCountry.longitude.toFixed(2)}
                </span>
              </div>
              {selectedCountry.overall_score !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vulnerability score</span>
                  <Badge variant={selectedCountry.overall_score >= 60 ? "destructive" : "default"}>
                    {selectedCountry.overall_score.toFixed(0)}/100
                  </Badge>
                </div>
              )}
              {activeLayer === "networks" && selectedCountry.iso3 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Measured connections</span>
                  <Badge variant="secondary">{networkLayer.selectedConnections}</Badge>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              onClick={() => setSelectedCountry(null)}
            >
              Close
            </Button>
          </div>
        )}

        {!isMobile && showStatusBadge && (
          <div className={cn(
            "absolute left-1/2 z-20 -translate-x-1/2",
            compactControls ? "bottom-3" : "bottom-28",
          )}>
            <Badge
              variant="secondary"
              className="border-primary/20 bg-card/90 px-3 py-1.5 backdrop-blur-sm"
            >
              <Globe className="mr-1.5 h-3 w-3" />
              <span className="font-orbitron">{ALL_COUNTRIES.length}</span>
              <span className="mx-1 text-muted-foreground">countries</span>
              <span className="mx-2 h-3 w-px bg-border" />
              <Crosshair className="mr-1.5 h-3 w-3 text-success" />
              <span className="font-orbitron">{countryData.length}</span>
              <span className="ml-1 text-muted-foreground">monitored</span>
              {activeLayer === "networks" && (
                <>
                  <span className="mx-2 h-3 w-px bg-border" />
                  <Network className="mr-1.5 h-3 w-3 text-primary" />
                  <span className="font-orbitron">{networkLayer.projectedEdges}</span>
                  <span className="ml-1 text-muted-foreground">displayed links</span>
                </>
              )}
            </Badge>
          </div>
        )}
      </div>
    );
  },
);

GlobalMap.displayName = "GlobalMap";
