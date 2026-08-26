import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Network, Route, Waves, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface CountryPoint {
  iso3: string;
  name: string;
  lon: number;
  lat: number;
  risk: number; // 0-100
}

type EvidenceStatus = "measured" | "unvalidated";
type Coordinate = [number, number];

type GraphRelationship = {
  id: string;
  subject_kind: string;
  subject_key: string;
  object_kind: string;
  object_key: string;
  relation_type: string;
  direction: string;
  evidence_strength: number | null;
  evidence_status: EvidenceStatus | string;
  confidence: number | null;
  method: string;
  source_table: string;
  observed_to: string | null;
  last_measured_at: string | null;
  decayed_weight: number | null;
};

type CanonicalEntityGeo = {
  id: string;
  canonical_name: string;
  display_name: string | null;
  entity_type: string;
  iso3: string | null;
  lat: number | null;
  lon: number | null;
};

type ResolvedNode = {
  id: string;
  label: string;
  entityType: string;
  iso3: string | null;
  coordinate: Coordinate;
  resolution: "entity_coordinate" | "country_anchor";
};

type SpatialEdge = {
  relationship: GraphRelationship;
  source: ResolvedNode;
  target: ResolvedNode;
  weight: number;
  confidence: number;
};

const graphClient = supabase as unknown as SupabaseClient;
const RELATION_FETCH_TYPES = ["trades_in", "borders", "member_of", "parent", "headquartered_in"] as const;
const MAX_EDGES_PER_RELATION = 180;
const MAX_VISIBLE_EDGES = 260;
const DEFAULT_MIN_CONFIDENCE = 0.5;

const relationColors: Record<string, string> = {
  trades_in: "#22d3ee",
  borders: "#94a3b8",
  member_of: "#a78bfa",
  parent: "#f59e0b",
  headquartered_in: "#34d399",
};

function clamp01(value: number | null | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function edgeWeight(edge: GraphRelationship) {
  return clamp01(edge.decayed_weight ?? edge.evidence_strength);
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function isValidCoordinate(lon: number | null, lat: number | null): lon is number {
  return Number.isFinite(Number(lon)) && Number.isFinite(Number(lat)) && Number(lon) >= -180 && Number(lon) <= 180 && Number(lat) >= -90 && Number(lat) <= 90;
}

function nearlySameCoordinate(a: Coordinate, b: Coordinate) {
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function resolveEntity(
  entity: CanonicalEntityGeo | undefined,
  countryPoints: Map<string, CountryPoint>,
): ResolvedNode | null {
  if (!entity) return null;
  const label = entity.display_name ?? entity.canonical_name;
  if (isValidCoordinate(entity.lon, entity.lat)) {
    return {
      id: entity.id,
      label,
      entityType: entity.entity_type,
      iso3: entity.iso3?.toUpperCase() ?? null,
      coordinate: [Number(entity.lon), Number(entity.lat)],
      resolution: "entity_coordinate",
    };
  }

  const iso3 = entity.iso3?.toUpperCase();
  const point = iso3 ? countryPoints.get(iso3) : undefined;
  if (!point) return null;
  return {
    id: entity.id,
    label,
    entityType: entity.entity_type,
    iso3,
    coordinate: [point.lon, point.lat],
    resolution: "country_anchor",
  };
}

function greatCircleArc(source: Coordinate, target: Coordinate, segments = 24): Coordinate[] {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const toDegrees = (radians: number) => (radians * 180) / Math.PI;
  const vector = ([lon, lat]: Coordinate) => {
    const lambda = toRadians(lon);
    const phi = toRadians(lat);
    const cosPhi = Math.cos(phi);
    return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)] as const;
  };

  const a = vector(source);
  const b = vector(target);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  if (!Number.isFinite(omega) || Math.abs(sinOmega) < 1e-6) return [source, target];

  const coordinates: Coordinate[] = [];
  let previousLon = source[0];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const weightA = Math.sin((1 - t) * omega) / sinOmega;
    const weightB = Math.sin(t * omega) / sinOmega;
    const x = weightA * a[0] + weightB * b[0];
    const y = weightA * a[1] + weightB * b[1];
    const z = weightA * a[2] + weightB * b[2];
    const length = Math.sqrt(x * x + y * y + z * z) || 1;
    let lon = toDegrees(Math.atan2(y / length, x / length));
    const lat = toDegrees(Math.asin(Math.max(-1, Math.min(1, z / length))));

    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    previousLon = lon;
    coordinates.push([lon, lat]);
  }
  return coordinates;
}

function balancedVisibleEdges(edges: SpatialEdge[], relationFilter: string) {
  const sorted = [...edges].sort((a, b) => b.weight - a.weight || b.confidence - a.confidence);
  if (relationFilter !== "all") return sorted.slice(0, MAX_VISIBLE_EDGES);

  const groups = new Map<string, SpatialEdge[]>();
  for (const edge of sorted) {
    const relation = edge.relationship.relation_type;
    const group = groups.get(relation) ?? [];
    group.push(edge);
    groups.set(relation, group);
  }

  const fairShare = Math.max(30, Math.floor(MAX_VISIBLE_EDGES / Math.max(1, groups.size)));
  const selected = new Map<string, SpatialEdge>();
  for (const group of groups.values()) {
    for (const edge of group.slice(0, fairShare)) selected.set(edge.relationship.id, edge);
  }

  if (selected.size < MAX_VISIBLE_EDGES) {
    for (const edge of sorted) {
      selected.set(edge.relationship.id, edge);
      if (selected.size >= MAX_VISIBLE_EDGES) break;
    }
  }
  return [...selected.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_VISIBLE_EDGES);
}

function downstreamEdgeIds(edges: SpatialEdge[], rootEntityIds: Set<string>, maxHops = 3) {
  const highlighted = new Set<string>();
  const visited = new Set(rootEntityIds);
  let frontier = new Set(rootEntityIds);

  for (let hop = 0; hop < maxHops && frontier.size > 0; hop += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      const relationship = edge.relationship;
      if (relationship.evidence_status !== "measured" || relationship.direction === "undirected") continue;
      if (relationship.relation_type === "correlates_with") continue;
      if (!frontier.has(relationship.subject_key)) continue;
      highlighted.add(relationship.id);
      if (!visited.has(relationship.object_key)) {
        visited.add(relationship.object_key);
        next.add(relationship.object_key);
      }
    }
    frontier = next;
  }

  return highlighted;
}

/**
 * 2D MapLibre global risk surface with an optional evidence-backed spatial-network layer.
 * Network arcs are derived only from measured/unvalidated graph relationships whose
 * canonical entities already have a coordinate or an explicit country binding.
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
  const [networksEnabled, setNetworksEnabled] = useState(false);
  const [relationFilter, setRelationFilter] = useState("all");
  const [minConfidence, setMinConfidence] = useState(DEFAULT_MIN_CONFIDENCE);
  const [includeUnvalidated, setIncludeUnvalidated] = useState(false);
  const [propagationMode, setPropagationMode] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const networkEdgesQuery = useQuery({
    queryKey: ["spatial-map-network-edges"],
    enabled: networksEnabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GraphRelationship[]> => {
      const batches = await Promise.all(
        RELATION_FETCH_TYPES.map(async (relationType) => {
          const { data, error } = await graphClient
            .from("graph_relationship_current")
            .select(
              "id,subject_kind,subject_key,object_kind,object_key,relation_type,direction,evidence_strength,evidence_status,confidence,method,source_table,observed_to,last_measured_at,decayed_weight",
            )
            .eq("subject_kind", "entity")
            .eq("object_kind", "entity")
            .eq("relation_type", relationType)
            .in("evidence_status", ["measured", "unvalidated"])
            .not("decayed_weight", "is", null)
            .order("decayed_weight", { ascending: false })
            .limit(MAX_EDGES_PER_RELATION);
          if (error) throw error;
          return (data ?? []) as unknown as GraphRelationship[];
        }),
      );
      return batches.flat();
    },
  });

  const entityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of networkEdgesQuery.data ?? []) {
      ids.add(edge.subject_key);
      ids.add(edge.object_key);
    }
    return [...ids];
  }, [networkEdgesQuery.data]);

  const entitiesQuery = useQuery({
    queryKey: ["spatial-map-network-entities", entityIds.join(",")],
    enabled: networksEnabled && entityIds.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<CanonicalEntityGeo[]> => {
      const batches = await Promise.all(
        chunk(entityIds, 100).map(async (ids) => {
          const { data, error } = await graphClient
            .from("canonical_entities")
            .select("id,canonical_name,display_name,entity_type,iso3,lat,lon")
            .in("id", ids);
          if (error) throw error;
          return (data ?? []) as unknown as CanonicalEntityGeo[];
        }),
      );
      return batches.flat();
    },
  });

  const countryPoints = useMemo(
    () => new Map(points.map((point) => [point.iso3.toUpperCase(), point])),
    [points],
  );
  const entityById = useMemo(
    () => new Map((entitiesQuery.data ?? []).map((entity) => [entity.id, entity])),
    [entitiesQuery.data],
  );

  const spatialEdges = useMemo(() => {
    const output: SpatialEdge[] = [];
    for (const relationship of networkEdgesQuery.data ?? []) {
      if (!includeUnvalidated && relationship.evidence_status !== "measured") continue;
      const confidence = clamp01(relationship.confidence);
      if (confidence < minConfidence) continue;
      if (relationFilter !== "all" && relationship.relation_type !== relationFilter) continue;

      const source = resolveEntity(entityById.get(relationship.subject_key), countryPoints);
      const target = resolveEntity(entityById.get(relationship.object_key), countryPoints);
      if (!source || !target || nearlySameCoordinate(source.coordinate, target.coordinate)) continue;
      output.push({ relationship, source, target, confidence, weight: edgeWeight(relationship) });
    }
    return balancedVisibleEdges(output, relationFilter);
  }, [countryPoints, entityById, includeUnvalidated, minConfidence, networkEdgesQuery.data, relationFilter]);

  const relationTypes = useMemo(
    () => [...new Set((networkEdgesQuery.data ?? []).map((edge) => edge.relation_type))].sort(),
    [networkEdgesQuery.data],
  );

  const selectedCountryRootIds = useMemo(() => {
    if (!selectedIso3) return new Set<string>();
    const iso = selectedIso3.toUpperCase();
    return new Set(
      (entitiesQuery.data ?? [])
        .filter((entity) => entity.iso3?.toUpperCase() === iso && (entity.entity_type === "country" || entity.entity_type === "territory"))
        .map((entity) => entity.id),
    );
  }, [entitiesQuery.data, selectedIso3]);

  const propagationEdgeIds = useMemo(
    () => (propagationMode ? downstreamEdgeIds(spatialEdges, selectedCountryRootIds) : new Set<string>()),
    [propagationMode, selectedCountryRootIds, spatialEdges],
  );

  const selectedEdge = useMemo(
    () => spatialEdges.find((edge) => edge.relationship.id === selectedEdgeId) ?? null,
    [selectedEdgeId, spatialEdges],
  );

  useEffect(() => {
    if (selectedEdgeId && !selectedEdge) setSelectedEdgeId(null);
  }, [selectedEdge, selectedEdgeId]);

  const networkData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: networksEnabled
        ? spatialEdges.map((edge) => ({
            type: "Feature" as const,
            geometry: {
              type: "LineString" as const,
              coordinates: greatCircleArc(edge.source.coordinate, edge.target.coordinate),
            },
            properties: {
              id: edge.relationship.id,
              relation: edge.relationship.relation_type,
              status: edge.relationship.evidence_status,
              direction: edge.relationship.direction,
              weight: edge.weight,
              confidence: edge.confidence,
              propagation: propagationEdgeIds.has(edge.relationship.id),
            },
          }))
        : [],
    }),
    [networksEnabled, propagationEdgeIds, spatialEdges],
  );

  const networkTargets = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: networksEnabled
        ? spatialEdges
            .filter((edge) => edge.relationship.direction !== "undirected")
            .map((edge) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: edge.target.coordinate },
              properties: {
                id: edge.relationship.id,
                propagation: propagationEdgeIds.has(edge.relationship.id),
                confidence: edge.confidence,
              },
            }))
        : [],
    }),
    [networksEnabled, propagationEdgeIds, spatialEdges],
  );

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
      map.addSource("network-edges", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("network-targets", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "network-measured",
        type: "line",
        source: "network-edges",
        filter: ["==", ["get", "status"], "measured"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match", ["get", "relation"],
            "trades_in", relationColors.trades_in,
            "borders", relationColors.borders,
            "member_of", relationColors.member_of,
            "parent", relationColors.parent,
            "headquartered_in", relationColors.headquartered_in,
            "#38bdf8",
          ],
          "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 0.7, 1, 4.5],
          "line-opacity": ["interpolate", ["linear"], ["get", "confidence"], 0, 0.2, 1, 0.82],
        },
      });
      map.addLayer({
        id: "network-unvalidated",
        type: "line",
        source: "network-edges",
        filter: ["==", ["get", "status"], "unvalidated"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#fbbf24",
          "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 0.7, 1, 3.5],
          "line-opacity": 0.55,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "network-propagation",
        type: "line",
        source: "network-edges",
        filter: ["==", ["get", "propagation"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#facc15",
          "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 2, 1, 7],
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "network-selected",
        type: "line",
        source: "network-edges",
        filter: ["==", ["get", "id"], ""],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 6,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "network-target-points",
        type: "circle",
        source: "network-targets",
        paint: {
          "circle-radius": ["case", ["==", ["get", "propagation"], true], 4.5, 2.5],
          "circle-color": ["case", ["==", ["get", "propagation"], true], "#facc15", "#e2e8f0"],
          "circle-opacity": ["interpolate", ["linear"], ["get", "confidence"], 0, 0.35, 1, 0.9],
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 0.8,
        },
      });

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
      map.on("click", "country-points", (event) => {
        const feature = event.features?.[0];
        if (feature?.properties?.iso3) onSelect(String(feature.properties.iso3));
      });
      const selectNetworkEdge = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (feature?.properties?.id) setSelectedEdgeId(String(feature.properties.id));
      };
      map.on("click", "network-measured", selectNetworkEdge);
      map.on("click", "network-unvalidated", selectNetworkEdge);
      map.on("mouseenter", "country-points", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "country-points", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "network-measured", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "network-measured", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "network-unvalidated", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "network-unvalidated", () => (map.getCanvas().style.cursor = ""));
      ready.current = true;

      const source = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
      source?.setData({
        type: "FeatureCollection",
        features: points.map((point) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [point.lon, point.lat] },
          properties: { iso3: point.iso3, name: point.name, risk: point.risk },
        })),
      });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // Map initialization is intentionally one-time; mutable data is synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const source = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: points.map((point) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        properties: { iso3: point.iso3, name: point.name, risk: point.risk },
      })),
    });
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const source = map.getSource("network-edges") as maplibregl.GeoJSONSource | undefined;
    const targetSource = map.getSource("network-targets") as maplibregl.GeoJSONSource | undefined;
    source?.setData(networkData);
    targetSource?.setData(networkTargets);
  }, [networkData, networkTargets]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer("network-selected")) return;
    map.setFilter("network-selected", ["==", ["get", "id"], selectedEdgeId ?? ""]);
  }, [selectedEdgeId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer("country-points")) return;
    map.setPaintProperty("country-points", "circle-stroke-width", [
      "case",
      ["==", ["get", "iso3"], ["literal", selectedIso3 ?? ""]],
      2.5, 0.4,
    ]);
    if (selectedIso3) {
      const point = points.find((candidate) => candidate.iso3 === selectedIso3);
      if (point) map.flyTo({ center: [point.lon, point.lat], zoom: 4, speed: 0.8 });
    }
  }, [selectedIso3, points]);

  const networkLoading = networksEnabled && (networkEdgesQuery.isLoading || entitiesQuery.isLoading);
  const networkError = networksEnabled && (networkEdgesQuery.isError || entitiesQuery.isError);
  const canTrace = networksEnabled && Boolean(selectedIso3) && selectedCountryRootIds.size > 0;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border/60 bg-background">
      <div ref={ref} className="absolute inset-0" />

      <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-4.5rem)] flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            setNetworksEnabled((enabled) => !enabled);
            if (networksEnabled) {
              setPropagationMode(false);
              setSelectedEdgeId(null);
            }
          }}
          className={`flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition ${
            networksEnabled
              ? "border-cyan-400/50 bg-cyan-950/90 text-cyan-100"
              : "border-border/70 bg-background/90 text-foreground hover:bg-muted/90"
          }`}
          aria-pressed={networksEnabled}
        >
          <Network className="h-4 w-4" />
          Networks
          {networksEnabled && <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 font-mono">{spatialEdges.length}</span>}
        </button>

        {networksEnabled && (
          <div className="w-[min(92vw,430px)] rounded-md border border-border/70 bg-background/92 p-2.5 shadow-xl backdrop-blur">
            <div className="grid gap-2 sm:grid-cols-[1fr_110px_auto] sm:items-end">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Network
                <select
                  value={relationFilter}
                  onChange={(event) => setRelationFilter(event.target.value)}
                  className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="all">All spatial</option>
                  {relationTypes.map((relation) => (
                    <option key={relation} value={relation}>{titleCase(relation)}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Min confidence
                <select
                  value={String(minConfidence)}
                  onChange={(event) => setMinConfidence(Number(event.target.value))}
                  className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="0.5">0.50</option>
                  <option value="0.7">0.70</option>
                  <option value="0.85">0.85</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setPropagationMode((active) => !active)}
                disabled={!canTrace}
                className={`flex h-8 items-center justify-center gap-1.5 rounded border px-2 text-xs transition ${
                  propagationMode
                    ? "border-yellow-400/50 bg-yellow-400/15 text-yellow-200"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                } disabled:cursor-not-allowed disabled:opacity-40`}
                title={canTrace ? "Trace up to three directed downstream hops from the selected country" : "Select a mapped country to trace directed downstream relationships"}
              >
                <Waves className="h-3.5 w-3.5" />
                Trace
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includeUnvalidated}
                  onChange={(event) => setIncludeUnvalidated(event.target.checked)}
                  className="accent-amber-400"
                />
                Show unvalidated
              </label>
              <span>line width = decayed evidence weight</span>
              <span>opacity = confidence</span>
              <span>target dot = direction</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              {Object.entries(relationColors).map(([relation, color]) => (
                <span key={relation} className="flex items-center gap-1 text-muted-foreground">
                  <span className="h-0.5 w-4 rounded" style={{ backgroundColor: color }} />
                  {titleCase(relation)}
                </span>
              ))}
            </div>

            {networkLoading && <p className="mt-2 text-[10px] text-muted-foreground">Resolving evidence-backed network geography…</p>}
            {networkError && <p className="mt-2 text-[10px] text-rose-300">Network evidence is unavailable for this session or access tier.</p>}
            {!networkLoading && !networkError && spatialEdges.length === 0 && (
              <p className="mt-2 text-[10px] text-muted-foreground">No relationships satisfy the current spatial/evidence filters. Unlocated entities remain in the Planetary Graph rather than being assigned guessed coordinates.</p>
            )}
          </div>
        )}
      </div>

      {selectedEdge && (
        <aside className="absolute bottom-10 right-2 z-10 w-[min(92vw,360px)] rounded-md border border-border/70 bg-background/95 p-3 text-xs shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                <Route className="h-3.5 w-3.5 text-primary" />
                {titleCase(selectedEdge.relationship.relation_type)}
              </div>
              <p className="leading-5 text-muted-foreground">
                <span className="text-foreground">{selectedEdge.source.label}</span>
                {selectedEdge.relationship.direction === "undirected" ? " ↔ " : " → "}
                <span className="text-foreground">{selectedEdge.target.label}</span>
              </p>
            </div>
            <button type="button" onClick={() => setSelectedEdgeId(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close network evidence inspector">
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            <div><dt className="text-muted-foreground">Evidence</dt><dd className={selectedEdge.relationship.evidence_status === "measured" ? "text-emerald-300" : "text-amber-300"}>{titleCase(selectedEdge.relationship.evidence_status)}</dd></div>
            <div><dt className="text-muted-foreground">Confidence</dt><dd className="font-mono text-foreground">{selectedEdge.confidence.toFixed(3)}</dd></div>
            <div><dt className="text-muted-foreground">Current weight</dt><dd className="font-mono text-foreground">{selectedEdge.weight.toFixed(3)}</dd></div>
            <div><dt className="text-muted-foreground">Direction</dt><dd className="text-foreground">{titleCase(selectedEdge.relationship.direction)}</dd></div>
            <div><dt className="text-muted-foreground">Method</dt><dd className="break-words text-foreground">{selectedEdge.relationship.method || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Provenance</dt><dd className="break-words font-mono text-foreground">{selectedEdge.relationship.source_table || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Last measured</dt><dd className="text-foreground">{formatDate(selectedEdge.relationship.last_measured_at ?? selectedEdge.relationship.observed_to)}</dd></div>
            <div><dt className="text-muted-foreground">Map resolution</dt><dd className="text-foreground">{selectedEdge.source.resolution === "entity_coordinate" && selectedEdge.target.resolution === "entity_coordinate" ? "Entity coordinates" : "Includes country anchor"}</dd></div>
          </dl>

          {propagationEdgeIds.has(selectedEdge.relationship.id) && (
            <p className="mt-3 rounded border border-yellow-400/20 bg-yellow-400/10 px-2 py-1.5 text-[10px] leading-4 text-yellow-100">
              This edge is reachable in the selected directed trace. Reachability does not by itself establish causation.
            </p>
          )}
        </aside>
      )}

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
        {points.length} countries · risk-weighted{networksEnabled ? ` · ${spatialEdges.length} spatial relationships` : ""}
      </div>
    </div>
  );
}
