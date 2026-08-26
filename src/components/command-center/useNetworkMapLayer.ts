import { useEffect, useMemo, useState } from "react";
import maplibregl from "maplibre-gl";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ALL_COUNTRIES, getCountryCoordinates } from "@/lib/geo/all-countries";

const graphClient = supabase as unknown as SupabaseClient;

const EDGE_SOURCE_ID = "aicis-network-edges";
const EDGE_LAYER_ID = "aicis-network-edges-line";
const TARGET_SOURCE_ID = "aicis-network-targets";
const TARGET_LAYER_ID = "aicis-network-targets-circle";
const MAX_NETWORK_EDGES = 160;

interface GraphRelationship {
  id: string;
  subject_kind: string;
  subject_key: string;
  object_kind: string;
  object_key: string;
  relation_type: string;
  direction: string;
  evidence_strength: number | null;
  evidence_status: string;
  sample_size: number | null;
  method: string;
  confidence: number | null;
  observed_to: string | null;
  decayed_weight: number | null;
}

interface CountryEndpoint {
  iso3: string;
  domain: string;
  countryName: string;
  coordinates: [number, number];
}

interface ProjectedRelationship {
  edge: GraphRelationship;
  source: CountryEndpoint;
  target: CountryEndpoint;
}

export interface NetworkMapLayerState {
  loading: boolean;
  error: string | null;
  loadedMeasuredEdges: number;
  projectedEdges: number;
  selectedConnections: number;
}

interface UseNetworkMapLayerOptions {
  map: maplibregl.Map | null;
  isMapLoaded: boolean;
  enabled: boolean;
  selectedIso3?: string | null;
}

function normalizeText(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveCountryDomain(kind: string, key: string): CountryEndpoint | null {
  if (kind !== "country_domain") return null;
  const [countryKeyRaw, domainRaw = "unknown"] = key.split("/");
  const countryKey = countryKeyRaw.trim().toUpperCase();
  const country = ALL_COUNTRIES.find(
    (candidate) =>
      candidate.iso3 === countryKey ||
      candidate.iso2 === countryKey ||
      candidate.name.toUpperCase() === countryKey,
  );
  if (!country) return null;

  const coordinates = getCountryCoordinates(country.iso2);
  if (!coordinates) return null;

  return {
    iso3: country.iso3,
    domain: normalizeText(domainRaw),
    countryName: country.name,
    coordinates: [coordinates.lng, coordinates.lat],
  };
}

function curvedLine(start: [number, number], end: [number, number]): [number, number][] {
  const [startLng, startLat] = start;
  const [endLng, endLat] = end;
  let deltaLng = endLng - startLng;
  if (deltaLng > 180) deltaLng -= 360;
  if (deltaLng < -180) deltaLng += 360;

  const distance = Math.hypot(deltaLng, endLat - startLat);
  const arc = Math.min(18, Math.max(2, distance * 0.12));
  const points: [number, number][] = [];

  for (let index = 0; index <= 24; index += 1) {
    const t = index / 24;
    const lng = startLng + deltaLng * t;
    const lat = startLat + (endLat - startLat) * t + Math.sin(Math.PI * t) * arc;
    points.push([lng, Math.max(-85, Math.min(85, lat))]);
  }

  return points;
}

function formatObservationDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString();
}

function makePopupContent(properties: Record<string, string | number>) {
  const root = document.createElement("div");
  root.style.minWidth = "230px";
  root.style.fontFamily = "system-ui, sans-serif";

  const title = document.createElement("div");
  title.textContent = `${String(properties.source_country)} → ${String(properties.target_country)}`;
  title.style.fontWeight = "700";
  title.style.marginBottom = "6px";
  root.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent = `${String(properties.source_domain)} → ${String(properties.target_domain)}`;
  subtitle.style.fontSize = "12px";
  subtitle.style.opacity = "0.75";
  subtitle.style.marginBottom = "8px";
  root.appendChild(subtitle);

  const rows: Array<[string, string]> = [
    ["Relationship", normalizeText(String(properties.relation_type))],
    ["Direction", normalizeText(String(properties.direction))],
    ["Current weight", Number(properties.weight).toFixed(3)],
    ["Confidence", Number(properties.confidence).toFixed(3)],
    ["Sample size", Number(properties.sample_size) > 0 ? String(properties.sample_size) : "Not recorded"],
    ["Method", String(properties.method)],
    ["Observed to", String(properties.observed_to)],
  ];

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.gap = "12px";
    row.style.fontSize = "12px";
    row.style.marginTop = "4px";

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.opacity = "0.65";
    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    valueEl.style.textAlign = "right";

    row.append(labelEl, valueEl);
    root.appendChild(row);
  }

  const note = document.createElement("div");
  note.textContent = "Measured graph evidence. A visible relationship is not automatically causal.";
  note.style.fontSize = "11px";
  note.style.opacity = "0.65";
  note.style.marginTop = "9px";
  root.appendChild(note);

  return root;
}

export function useNetworkMapLayer({
  map,
  isMapLoaded,
  enabled,
  selectedIso3,
}: UseNetworkMapLayerOptions): NetworkMapLayerState {
  const [relationships, setRelationships] = useState<GraphRelationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || relationships.length > 0) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await graphClient
        .from("graph_relationship_current")
        .select(
          "id,subject_kind,subject_key,object_kind,object_key,relation_type,direction,evidence_strength,evidence_status,sample_size,method,confidence,observed_to,decayed_weight",
        )
        .eq("evidence_status", "measured")
        .not("decayed_weight", "is", null)
        .order("decayed_weight", { ascending: false })
        .limit(MAX_NETWORK_EDGES);

      if (cancelled) return;
      if (queryError) {
        setError("Measured network evidence could not be loaded.");
        setLoading(false);
        return;
      }

      setRelationships((data ?? []) as unknown as GraphRelationship[]);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, relationships.length]);

  const projected = useMemo<ProjectedRelationship[]>(() => {
    const result: ProjectedRelationship[] = [];
    for (const edge of relationships) {
      const source = resolveCountryDomain(edge.subject_kind, edge.subject_key);
      const target = resolveCountryDomain(edge.object_kind, edge.object_key);
      if (!source || !target || source.iso3 === target.iso3) continue;
      result.push({ edge, source, target });
    }
    return result;
  }, [relationships]);

  const edgeData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: projected.map(({ edge, source, target }) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: curvedLine(source.coordinates, target.coordinates),
        },
        properties: {
          id: edge.id,
          source_iso3: source.iso3,
          target_iso3: target.iso3,
          source_country: source.countryName,
          target_country: target.countryName,
          source_domain: source.domain,
          target_domain: target.domain,
          relation_type: edge.relation_type,
          direction: edge.direction,
          weight: edge.decayed_weight ?? edge.evidence_strength ?? 0,
          confidence: edge.confidence ?? 0,
          sample_size: edge.sample_size ?? 0,
          method: edge.method || "Not recorded",
          observed_to: formatObservationDate(edge.observed_to),
          selected:
            selectedIso3 && (source.iso3 === selectedIso3 || target.iso3 === selectedIso3) ? 1 : 0,
        },
      })),
    }),
    [projected, selectedIso3],
  );

  const targetData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: projected.map(({ edge, source, target }) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: target.coordinates },
        properties: {
          id: edge.id,
          target_iso3: target.iso3,
          selected:
            selectedIso3 && (source.iso3 === selectedIso3 || target.iso3 === selectedIso3) ? 1 : 0,
        },
      })),
    }),
    [projected, selectedIso3],
  );

  useEffect(() => {
    if (!map || !isMapLoaded) return;

    if (!map.getSource(EDGE_SOURCE_ID)) {
      map.addSource(EDGE_SOURCE_ID, { type: "geojson", data: edgeData });
    }
    if (!map.getLayer(EDGE_LAYER_ID)) {
      map.addLayer({
        id: EDGE_LAYER_ID,
        type: "line",
        source: EDGE_SOURCE_ID,
        layout: { visibility: enabled ? "visible" : "none" },
        paint: {
          "line-color": ["case", ["==", ["get", "selected"], 1], "#22d3ee", "#a78bfa"],
          "line-opacity": [
            "case",
            ["==", ["get", "selected"], 1],
            0.95,
            ["interpolate", ["linear"], ["get", "confidence"], 0, 0.22, 1, 0.72],
          ],
          "line-width": [
            "case",
            ["==", ["get", "selected"], 1],
            4.5,
            ["interpolate", ["linear"], ["get", "weight"], 0, 1, 1, 4],
          ],
        },
      });
    }

    if (!map.getSource(TARGET_SOURCE_ID)) {
      map.addSource(TARGET_SOURCE_ID, { type: "geojson", data: targetData });
    }
    if (!map.getLayer(TARGET_LAYER_ID)) {
      map.addLayer({
        id: TARGET_LAYER_ID,
        type: "circle",
        source: TARGET_SOURCE_ID,
        layout: { visibility: enabled ? "visible" : "none" },
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 5, 3],
          "circle-color": ["case", ["==", ["get", "selected"], 1], "#22d3ee", "#c4b5fd"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });
    }

    const onClick = (event: maplibregl.MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: [EDGE_LAYER_ID] })[0];
      if (!feature?.properties) return;
      const properties = feature.properties as Record<string, string | number>;
      new maplibregl.Popup({ closeButton: true, maxWidth: "340px" })
        .setLngLat(event.lngLat)
        .setDOMContent(makePopupContent(properties))
        .addTo(map);
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", EDGE_LAYER_ID, onClick);
    map.on("mouseenter", EDGE_LAYER_ID, onEnter);
    map.on("mouseleave", EDGE_LAYER_ID, onLeave);

    return () => {
      map.off("click", EDGE_LAYER_ID, onClick);
      map.off("mouseenter", EDGE_LAYER_ID, onEnter);
      map.off("mouseleave", EDGE_LAYER_ID, onLeave);
      if (map.getLayer(TARGET_LAYER_ID)) map.removeLayer(TARGET_LAYER_ID);
      if (map.getSource(TARGET_SOURCE_ID)) map.removeSource(TARGET_SOURCE_ID);
      if (map.getLayer(EDGE_LAYER_ID)) map.removeLayer(EDGE_LAYER_ID);
      if (map.getSource(EDGE_SOURCE_ID)) map.removeSource(EDGE_SOURCE_ID);
    };
  }, [map, isMapLoaded]);

  useEffect(() => {
    if (!map || !isMapLoaded) return;
    const edgeSource = map.getSource(EDGE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const targetSource = map.getSource(TARGET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    edgeSource?.setData(edgeData);
    targetSource?.setData(targetData);

    if (map.getLayer(EDGE_LAYER_ID)) {
      map.setLayoutProperty(EDGE_LAYER_ID, "visibility", enabled ? "visible" : "none");
    }
    if (map.getLayer(TARGET_LAYER_ID)) {
      map.setLayoutProperty(TARGET_LAYER_ID, "visibility", enabled ? "visible" : "none");
    }
  }, [edgeData, enabled, isMapLoaded, map, targetData]);

  const normalizedSelected = selectedIso3?.toUpperCase() ?? null;
  const selectedConnections = normalizedSelected
    ? projected.filter(
        ({ source, target }) => source.iso3 === normalizedSelected || target.iso3 === normalizedSelected,
      ).length
    : 0;

  return {
    loading,
    error,
    loadedMeasuredEdges: relationships.length,
    projectedEdges: projected.length,
    selectedConnections,
  };
}
