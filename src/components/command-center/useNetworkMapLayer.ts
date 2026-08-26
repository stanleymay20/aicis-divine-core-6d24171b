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
const MAX_NETWORK_EDGES = 240;
const ENTITY_CHUNK_SIZE = 100;
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection" as const, features: [] };

interface GraphRelationship {
  id: string;
  subject_key: string;
  object_key: string;
  relation_type: string;
  direction: string;
  evidence_strength: number | null;
  sample_size: number | null;
  method: string;
  confidence: number | null;
  observed_to: string | null;
  decayed_weight: number | null;
}

interface CanonicalEntity {
  id: string;
  canonical_name: string;
  display_name: string | null;
  entity_type: string;
  iso3: string | null;
  lat: number | null;
  lon: number | null;
}

type SpatialPrecision = "exact" | "country-level";

interface SpatialEndpoint {
  id: string;
  label: string;
  entityType: string;
  iso3: string | null;
  coordinates: [number, number];
  precision: SpatialPrecision;
}

interface ProjectedRelationship {
  edge: GraphRelationship;
  source: SpatialEndpoint;
  target: SpatialEndpoint;
  weight: number;
  confidence: number;
}

export interface NetworkMapLayerState {
  loading: boolean;
  error: string | null;
  totalMeasuredEdges: number;
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

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function countryCentroid(iso3: string): [number, number] | null {
  const country = ALL_COUNTRIES.find((candidate) => candidate.iso3 === iso3.toUpperCase());
  if (!country) return null;
  const coordinates = getCountryCoordinates(country.iso2);
  return coordinates ? [coordinates.lng, coordinates.lat] : null;
}

function resolveEntityLocation(entity: CanonicalEntity | undefined): SpatialEndpoint | null {
  if (!entity) return null;
  const label = entity.display_name?.trim() || entity.canonical_name;
  const entityType = normalizeText(entity.entity_type);
  const iso3 = entity.iso3?.toUpperCase() ?? null;

  if (Number.isFinite(entity.lat) && Number.isFinite(entity.lon)) {
    return {
      id: entity.id,
      label,
      entityType,
      iso3,
      coordinates: [Number(entity.lon), Number(entity.lat)],
      precision: "exact",
    };
  }

  if (!iso3) return null;
  const centroid = countryCentroid(iso3);
  if (!centroid) return null;

  return {
    id: entity.id,
    label,
    entityType,
    iso3,
    coordinates: centroid,
    precision: "country-level",
  };
}

function clampUnitInterval(value: number) {
  return Math.max(0, Math.min(1, value));
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

function precisionLabel(value: string) {
  return value === "exact" ? "Exact entity coordinates" : "Country-level placement";
}

function makePopupContent(properties: Record<string, string | number>) {
  const root = document.createElement("div");
  root.style.minWidth = "250px";
  root.style.fontFamily = "system-ui, sans-serif";

  const title = document.createElement("div");
  title.textContent = `${String(properties.source_label)} → ${String(properties.target_label)}`;
  title.style.fontWeight = "700";
  title.style.marginBottom = "6px";
  root.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent = `${String(properties.source_type)} → ${String(properties.target_type)}`;
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
    ["Source placement", precisionLabel(String(properties.source_precision))],
    ["Target placement", precisionLabel(String(properties.target_precision))],
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
  note.textContent =
    "Measured graph evidence. Country-level placement uses the entity's recorded ISO3 and does not imply an exact physical location. A visible relationship is not automatically causal.";
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
  const [entities, setEntities] = useState<CanonicalEntity[]>([]);
  const [totalMeasuredEdges, setTotalMeasuredEdges] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedSelected = selectedIso3?.toUpperCase() ?? null;

  useEffect(() => {
    if (!enabled || relationships.length > 0) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      const { data, error: relationshipError, count } = await graphClient
        .from("graph_relationship_current")
        .select(
          "id,subject_key,object_key,relation_type,direction,evidence_strength,sample_size,method,confidence,observed_to,decayed_weight",
          { count: "exact" },
        )
        .eq("evidence_status", "measured")
        .eq("subject_kind", "entity")
        .eq("object_kind", "entity")
        .not("decayed_weight", "is", null)
        .not("confidence", "is", null)
        .order("decayed_weight", { ascending: false })
        .limit(MAX_NETWORK_EDGES);

      if (cancelled) return;
      if (relationshipError) {
        setError("Measured entity-network evidence could not be loaded.");
        setLoading(false);
        return;
      }

      const loadedRelationships = (data ?? []) as unknown as GraphRelationship[];
      const entityIds = [
        ...new Set(loadedRelationships.flatMap((edge) => [edge.subject_key, edge.object_key])),
      ];

      const entityChunks = chunkValues(entityIds, ENTITY_CHUNK_SIZE);
      const entityResponses = await Promise.all(
        entityChunks.map((chunk) =>
          graphClient
            .from("canonical_entities")
            .select("id,canonical_name,display_name,entity_type,iso3,lat,lon")
            .in("id", chunk),
        ),
      );

      if (cancelled) return;
      const failedEntityQuery = entityResponses.find((response) => response.error);
      if (failedEntityQuery) {
        setError("Network relationships loaded, but their canonical entity geography could not be resolved.");
        setLoading(false);
        return;
      }

      const loadedEntities = entityResponses.flatMap(
        (response) => (response.data ?? []) as unknown as CanonicalEntity[],
      );
      setRelationships(loadedRelationships);
      setEntities(loadedEntities);
      setTotalMeasuredEdges(count ?? loadedRelationships.length);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, relationships.length]);

  const entityIndex = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );

  const projected = useMemo<ProjectedRelationship[]>(() => {
    const result: ProjectedRelationship[] = [];
    for (const edge of relationships) {
      const source = resolveEntityLocation(entityIndex.get(edge.subject_key));
      const target = resolveEntityLocation(entityIndex.get(edge.object_key));
      const weight = Number(edge.decayed_weight);
      const confidence = Number(edge.confidence);
      if (!source || !target || !Number.isFinite(weight) || !Number.isFinite(confidence)) continue;

      const spatialDistance = Math.hypot(
        target.coordinates[0] - source.coordinates[0],
        target.coordinates[1] - source.coordinates[1],
      );
      if (spatialDistance < 0.01) continue;

      result.push({
        edge,
        source,
        target,
        weight: clampUnitInterval(weight),
        confidence: clampUnitInterval(confidence),
      });
    }
    return result;
  }, [entityIndex, relationships]);

  const edgeData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: projected.map(({ edge, source, target, weight, confidence }) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: curvedLine(source.coordinates, target.coordinates),
        },
        properties: {
          id: edge.id,
          source_iso3: source.iso3 ?? "",
          target_iso3: target.iso3 ?? "",
          source_label: source.label,
          target_label: target.label,
          source_type: source.entityType,
          target_type: target.entityType,
          source_precision: source.precision,
          target_precision: target.precision,
          relation_type: edge.relation_type,
          direction: edge.direction,
          weight,
          confidence,
          sample_size: edge.sample_size ?? 0,
          method: edge.method || "Not recorded",
          observed_to: formatObservationDate(edge.observed_to),
          selected:
            normalizedSelected &&
            (source.iso3 === normalizedSelected || target.iso3 === normalizedSelected)
              ? 1
              : 0,
        },
      })),
    }),
    [normalizedSelected, projected],
  );

  const targetData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: projected.map(({ edge, source, target }) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: target.coordinates },
        properties: {
          id: edge.id,
          relation_type: edge.relation_type,
          precision: target.precision,
          selected:
            normalizedSelected &&
            (source.iso3 === normalizedSelected || target.iso3 === normalizedSelected)
              ? 1
              : 0,
        },
      })),
    }),
    [normalizedSelected, projected],
  );

  useEffect(() => {
    if (!map || !isMapLoaded) return;

    if (!map.getSource(EDGE_SOURCE_ID)) {
      map.addSource(EDGE_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
    }
    if (!map.getLayer(EDGE_LAYER_ID)) {
      map.addLayer({
        id: EDGE_LAYER_ID,
        type: "line",
        source: EDGE_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "selected"], 1],
            "#22d3ee",
            [
              "match",
              ["get", "relation_type"],
              "borders",
              "#f59e0b",
              "trades_in",
              "#a78bfa",
              "member_of",
              "#38bdf8",
              "headquartered_in",
              "#34d399",
              "parent",
              "#94a3b8",
              "#c4b5fd",
            ],
          ],
          "line-opacity": [
            "case",
            ["==", ["get", "selected"], 1],
            0.98,
            ["interpolate", ["linear"], ["get", "confidence"], 0, 0.2, 1, 0.78],
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
      map.addSource(TARGET_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
    }
    if (!map.getLayer(TARGET_LAYER_ID)) {
      map.addLayer({
        id: TARGET_LAYER_ID,
        type: "circle",
        source: TARGET_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 5, 3],
          "circle-color": ["case", ["==", ["get", "selected"], 1], "#22d3ee", "#e2e8f0"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0f172a",
          "circle-opacity": ["case", ["==", ["get", "precision"], "exact"], 0.95, 0.6],
        },
      });
    }

    const onClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: [EDGE_LAYER_ID] })[0];
      if (!feature?.properties) return;
      const properties = feature.properties as Record<string, string | number>;
      new maplibregl.Popup({ closeButton: true, maxWidth: "360px" })
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
  }, [isMapLoaded, map]);

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

  const selectedConnections = normalizedSelected
    ? projected.filter(
        ({ source, target }) =>
          source.iso3 === normalizedSelected || target.iso3 === normalizedSelected,
      ).length
    : 0;

  return {
    loading,
    error,
    totalMeasuredEdges,
    loadedMeasuredEdges: relationships.length,
    projectedEdges: projected.length,
    selectedConnections,
  };
}
