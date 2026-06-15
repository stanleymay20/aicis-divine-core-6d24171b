import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface CountryPoint {
  iso3: string;
  name: string;
  lon: number;
  lat: number;
  risk: number; // 0-100
}

/**
 * 2D MapLibre choropleth-as-circles. Carto Dark Matter raster tiles —
 * free, no token. Click a country → onSelect(iso3).
 */
export function SpatialMapPanel({
  points,
  selectedIso3,
  onSelect,
}: {
  points: CountryPoint[];
  selectedIso3?: string | null;
  onSelect: (iso3: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: '© <a href="https://carto.com/">CARTO</a> · © OpenStreetMap',
          },
          labels: {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png"],
            tileSize: 256,
          },
        },
        layers: [
          { id: "bg", type: "raster", source: "carto" },
          { id: "lbl", type: "raster", source: "labels", minzoom: 2 },
        ],
      },
      center: [10, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("countries", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "country-points",
        type: "circle",
        source: "countries",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            1, ["interpolate", ["linear"], ["get", "risk"], 0, 3, 100, 10],
            5, ["interpolate", ["linear"], ["get", "risk"], 0, 6, 100, 22],
          ],
          "circle-color": [
            "interpolate", ["linear"], ["get", "risk"],
            0, "#1e6b3a",
            40, "#d4a017",
            60, "#e07c1f",
            80, "#dc2626",
            100, "#991b1b",
          ],
          "circle-opacity": 0.78,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": [
            "case",
            ["==", ["get", "iso3"], ["literal", selectedIso3 ?? ""]],
            2.5, 0.4,
          ],
        },
      });
      map.on("click", "country-points", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.iso3) onSelect(String(f.properties.iso3));
      });
      map.on("mouseenter", "country-points", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "country-points", () => (map.getCanvas().style.cursor = ""));
      ready.current = true;
      // Initial data load if points already provided
      const src = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: points.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lon, p.lat] },
          properties: { iso3: p.iso3, name: p.name, risk: p.risk },
        })),
      });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const src = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: points.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { iso3: p.iso3, name: p.name, risk: p.risk },
      })),
    });
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer("country-points")) return;
    map.setPaintProperty("country-points", "circle-stroke-width", [
      "case",
      ["==", ["get", "iso3"], ["literal", selectedIso3 ?? ""]],
      2.5, 0.4,
    ]);
    if (selectedIso3) {
      const p = points.find((x) => x.iso3 === selectedIso3);
      if (p) map.flyTo({ center: [p.lon, p.lat], zoom: 4, speed: 0.8 });
    }
  }, [selectedIso3, points]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border/60 bg-background">
      <div ref={ref} className="absolute inset-0" />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
        {points.length} countries · risk-weighted
      </div>
    </div>
  );
}
