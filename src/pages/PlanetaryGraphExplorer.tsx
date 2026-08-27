import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Clock3,
  Focus,
  GitBranch,
  Network,
  RotateCcw,
  Search,
  ShieldCheck,
  Waves,
} from "lucide-react";

const graphClient = supabase as unknown as SupabaseClient;

type EvidenceStatus = "measured" | "unvalidated" | "insufficient_evidence" | "refuted";
type EvidenceFilter = EvidenceStatus | "all";

interface GraphRelationship {
  id: string;
  relationship_key: string;
  subject_kind: string;
  subject_key: string;
  object_kind: string;
  object_key: string;
  relation_type: string;
  direction: "directed" | "undirected" | string;
  evidence_strength: number | null;
  evidence_status: EvidenceStatus | string;
  sample_size: number | null;
  window_days: number | null;
  country_count: number | null;
  method: string;
  source_table: string;
  source_row_id: string | null;
  confidence: number | null;
  observed_from: string | null;
  observed_to: string | null;
  last_measured_at: string | null;
  decay_half_life_days: number;
  metadata: Record<string, unknown> | null;
  evidence_age_days: number | null;
  decayed_weight: number | null;
}

interface CanonicalEntityLabel {
  id: string;
  canonical_name: string;
  display_name: string | null;
  entity_type: string;
}

interface GraphNode {
  id: string;
  kind: string;
  key: string;
  label: string;
  degree: number;
  weightedDegree: number;
}

interface RenderNode extends GraphNode {
  x: number;
  y: number;
  hop: number;
  radius: number;
}

interface GraphTotals {
  total: number;
  measured: number;
  unvalidated: number;
  insufficient: number;
  refuted: number;
}

const WIDTH = 920;
const HEIGHT = 640;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const MAX_VISIBLE_NODES = 48;
const MAX_VISIBLE_EDGES = 100;

function nodeId(kind: string, key: string) {
  return `${kind}:${key}`;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactLabel(value: string, limit = 23) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function formatNodeLabel(kind: string, key: string, entityLabels: Map<string, string>) {
  if (kind === "entity") return entityLabels.get(key) ?? `Entity ${key.slice(0, 8)}`;
  if (kind === "country_domain") {
    const [country, domain] = key.split("/");
    return domain ? `${country} · ${titleCase(domain)}` : key;
  }
  return titleCase(key.split("/").join(" · "));
}

function numberOrZero(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function formatNumber(value: number | null | undefined, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toFixed(digits);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function edgeWeight(edge: GraphRelationship) {
  return numberOrZero(edge.decayed_weight ?? edge.evidence_strength);
}

function statusClasses(status: string) {
  if (status === "measured") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "refuted") return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function nodeColor(kind: string) {
  if (kind === "country_domain") return "hsl(var(--chart-1))";
  if (kind === "system_node") return "hsl(var(--chart-2))";
  if (kind === "entity") return "hsl(var(--chart-3))";
  return "hsl(var(--chart-4))";
}

function makeNodeIndex(edges: GraphRelationship[], entityLabels: Map<string, string>) {
  const map = new Map<string, GraphNode>();

  const touch = (kind: string, key: string, weight: number) => {
    const id = nodeId(kind, key);
    const current = map.get(id);
    if (current) {
      current.degree += 1;
      current.weightedDegree += weight;
      return;
    }
    map.set(id, {
      id,
      kind,
      key,
      label: formatNodeLabel(kind, key, entityLabels),
      degree: 1,
      weightedDegree: weight,
    });
  };

  for (const edge of edges) {
    const weight = edgeWeight(edge);
    touch(edge.subject_kind, edge.subject_key, weight);
    touch(edge.object_kind, edge.object_key, weight);
  }

  return map;
}

function buildFocusSet(edges: GraphRelationship[], rootId: string, maxHops: number) {
  const included = new Set<string>([rootId]);
  const hopById = new Map<string, number>([[rootId, 0]]);
  let frontier = [rootId];

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
    const candidates = new Map<string, number>();
    for (const current of frontier) {
      for (const edge of edges) {
        const source = nodeId(edge.subject_kind, edge.subject_key);
        const target = nodeId(edge.object_kind, edge.object_key);
        const neighbor = source === current ? target : target === current ? source : null;
        if (!neighbor || included.has(neighbor)) continue;
        candidates.set(neighbor, Math.max(candidates.get(neighbor) ?? 0, edgeWeight(edge)));
      }
    }

    const room = MAX_VISIBLE_NODES - included.size;
    if (room <= 0) break;
    const next = [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, room)
      .map(([id]) => id);

    for (const id of next) {
      included.add(id);
      hopById.set(id, hop);
    }
    frontier = next;
  }

  return { included, hopById };
}

function layoutNodes(nodes: GraphNode[], hopById: Map<string, number>, rootId: string) {
  const byHop = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const hop = hopById.get(node.id) ?? 0;
    const bucket = byHop.get(hop) ?? [];
    bucket.push(node);
    byHop.set(hop, bucket);
  }

  const result: RenderNode[] = [];
  for (const [hop, group] of byHop) {
    group.sort((a, b) => b.weightedDegree - a.weightedDegree || a.label.localeCompare(b.label));
    if (hop === 0) {
      const root = group.find((node) => node.id === rootId) ?? group[0];
      if (root) result.push({ ...root, x: CX, y: CY, hop: 0, radius: 31 });
      continue;
    }

    const ringRadius = hop === 1 ? 155 : hop === 2 ? 270 : 355;
    const count = group.length;
    group.forEach((node, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, count) + hop * 0.17;
      const radius = Math.min(28, 17 + Math.log2(node.degree + 1) * 4);
      result.push({
        ...node,
        x: CX + Math.cos(angle) * ringRadius,
        y: CY + Math.sin(angle) * ringRadius,
        hop,
        radius,
      });
    });
  }
  return result;
}

function directedShockRadius(edges: GraphRelationship[], rootId: string, maxHops: number) {
  const hopById = new Map<string, number>([[rootId, 0]]);
  let frontier = [rootId];

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop += 1) {
    const next = new Set<string>();
    for (const current of frontier) {
      for (const edge of edges) {
        if (edge.direction === "undirected") continue;
        const source = nodeId(edge.subject_kind, edge.subject_key);
        const target = nodeId(edge.object_kind, edge.object_key);
        if (source !== current || hopById.has(target)) continue;
        hopById.set(target, hop);
        next.add(target);
      }
    }
    frontier = [...next];
  }

  return hopById;
}

function curvePath(source: RenderNode, target: RenderNode, seed: string) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / length;
  const ny = dx / length;
  const hash = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const bend = ((hash % 3) - 1) * 18;
  const mx = (source.x + target.x) / 2 + nx * bend;
  const my = (source.y + target.y) / 2 + ny * bend;
  return `M ${source.x} ${source.y} Q ${mx} ${my} ${target.x} ${target.y}`;
}

async function getCount(status?: EvidenceStatus) {
  let query = graphClient.from("graph_relationship_evidence").select("id", { count: "exact", head: true });
  if (status) query = query.eq("evidence_status", status);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export default function PlanetaryGraphExplorer() {
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("measured");
  const [relationFilter, setRelationFilter] = useState("all");
  const [minWeight, setMinWeight] = useState(0);
  const [hops, setHops] = useState(2);
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [shockMode, setShockMode] = useState(false);

  const edgesQuery = useQuery({
    queryKey: ["planetary-graph-explorer-edges"],
    queryFn: async (): Promise<GraphRelationship[]> => {
      const { data, error } = await graphClient
        .from("graph_relationship_current")
        .select(
          "id,relationship_key,subject_kind,subject_key,object_kind,object_key,relation_type,direction,evidence_strength,evidence_status,sample_size,window_days,country_count,method,source_table,source_row_id,confidence,observed_from,observed_to,last_measured_at,decay_half_life_days,metadata,evidence_age_days,decayed_weight",
        )
        .not("decayed_weight", "is", null)
        .order("decayed_weight", { ascending: false })
        .limit(180);
      if (error) throw error;
      return (data ?? []) as unknown as GraphRelationship[];
    },
  });

  const totalsQuery = useQuery({
    queryKey: ["planetary-graph-explorer-totals"],
    queryFn: async (): Promise<GraphTotals> => {
      const [total, measured, unvalidated, insufficient, refuted] = await Promise.all([
        getCount(),
        getCount("measured"),
        getCount("unvalidated"),
        getCount("insufficient_evidence"),
        getCount("refuted"),
      ]);
      return { total, measured, unvalidated, insufficient, refuted };
    },
  });

  const entityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edgesQuery.data ?? []) {
      if (edge.subject_kind === "entity") ids.add(edge.subject_key);
      if (edge.object_kind === "entity") ids.add(edge.object_key);
    }
    return [...ids];
  }, [edgesQuery.data]);

  const entityLabelsQuery = useQuery({
    queryKey: ["planetary-graph-explorer-entity-labels", entityIds.join(",")],
    enabled: entityIds.length > 0,
    queryFn: async (): Promise<CanonicalEntityLabel[]> => {
      const { data, error } = await graphClient
        .from("canonical_entities")
        .select("id,canonical_name,display_name,entity_type")
        .in("id", entityIds);
      if (error) throw error;
      return (data ?? []) as unknown as CanonicalEntityLabel[];
    },
  });

  const entityLabels = useMemo(
    () => new Map((entityLabelsQuery.data ?? []).map((entity) => [entity.id, entity.display_name ?? entity.canonical_name])),
    [entityLabelsQuery.data],
  );

  const allEdges = useMemo(() => edgesQuery.data ?? [], [edgesQuery.data]);
  const filteredEdges = useMemo(
    () =>
      allEdges.filter((edge) => {
        if (evidenceFilter !== "all" && edge.evidence_status !== evidenceFilter) return false;
        if (relationFilter !== "all" && edge.relation_type !== relationFilter) return false;
        return edgeWeight(edge) >= minWeight;
      }),
    [allEdges, evidenceFilter, relationFilter, minWeight],
  );

  const nodeIndex = useMemo(() => makeNodeIndex(filteredEdges, entityLabels), [filteredEdges, entityLabels]);
  const rankedNodes = useMemo(
    () => [...nodeIndex.values()].sort((a, b) => b.weightedDegree - a.weightedDegree || b.degree - a.degree),
    [nodeIndex],
  );

  useEffect(() => {
    if (rankedNodes.length === 0) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }
    if (!selectedNodeId || !nodeIndex.has(selectedNodeId)) {
      setSelectedNodeId(rankedNodes[0].id);
      setSelectedEdgeId(null);
    }
  }, [nodeIndex, rankedNodes, selectedNodeId]);

  const relationTypes = useMemo(
    () => [...new Set(allEdges.map((edge) => edge.relation_type))].sort(),
    [allEdges],
  );

  const focusGraph = useMemo(() => {
    if (!selectedNodeId) return { nodes: [] as RenderNode[], edges: [] as GraphRelationship[], hopById: new Map<string, number>() };
    const { included, hopById } = buildFocusSet(filteredEdges, selectedNodeId, hops);
    const nodes = [...included].map((id) => nodeIndex.get(id)).filter((node): node is GraphNode => Boolean(node));
    const renderNodes = layoutNodes(nodes, hopById, selectedNodeId);
    const edges = filteredEdges
      .filter((edge) => included.has(nodeId(edge.subject_kind, edge.subject_key)) && included.has(nodeId(edge.object_kind, edge.object_key)))
      .sort((a, b) => edgeWeight(b) - edgeWeight(a))
      .slice(0, MAX_VISIBLE_EDGES);
    return { nodes: renderNodes, edges, hopById };
  }, [filteredEdges, hops, nodeIndex, selectedNodeId]);

  const renderNodeMap = useMemo(() => new Map(focusGraph.nodes.map((node) => [node.id, node])), [focusGraph.nodes]);
  const shockRadius = useMemo(
    () => (shockMode && selectedNodeId ? directedShockRadius(focusGraph.edges, selectedNodeId, hops) : new Map<string, number>()),
    [focusGraph.edges, hops, selectedNodeId, shockMode],
  );

  const selectedNode = selectedNodeId ? nodeIndex.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? allEdges.find((edge) => edge.id === selectedEdgeId) ?? null : null;

  const topConnections = useMemo(() => {
    if (!selectedNodeId) return [];
    return filteredEdges
      .filter((edge) => {
        const source = nodeId(edge.subject_kind, edge.subject_key);
        const target = nodeId(edge.object_kind, edge.object_key);
        return source === selectedNodeId || target === selectedNodeId;
      })
      .sort((a, b) => edgeWeight(b) - edgeWeight(a))
      .slice(0, 8);
  }, [filteredEdges, selectedNodeId]);

  const searchMatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return rankedNodes.filter((node) => node.label.toLowerCase().includes(query) || node.key.toLowerCase().includes(query)).slice(0, 6);
  }, [rankedNodes, search]);

  const focusSearch = () => {
    const match = searchMatches[0];
    if (!match) return;
    setSelectedNodeId(match.id);
    setSelectedEdgeId(null);
    setSearch(match.label);
  };

  const resetView = () => {
    setEvidenceFilter("measured");
    setRelationFilter("all");
    setMinWeight(0);
    setHops(2);
    setShockMode(false);
    setSelectedEdgeId(null);
    setSearch("");
    setSelectedNodeId(rankedNodes[0]?.id ?? null);
  };

  const totals = totalsQuery.data;
  const visibleMeasured = focusGraph.edges.filter((edge) => edge.evidence_status === "measured").length;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 p-4 md:p-6 xl:p-8">
      <SEO
        title="Planetary Graph Explorer | AICIS"
        description="Explore AICIS evidence-weighted planetary relationships, temporal decay, network influence, and directed downstream reachability."
        path="/planetary-graph"
      />

      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-4xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Network className="h-4 w-4" />
            Verified world model
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Planetary Graph Explorer</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Navigate the living relationship network behind AICIS. Edge thickness reflects current decayed evidence weight; every connection remains inspectable back to method, sample, provenance table, confidence, and age.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={shockMode ? "default" : "outline"} onClick={() => setShockMode((value) => !value)} disabled={!selectedNodeId}>
            <Waves className="mr-2 h-4 w-4" />
            {shockMode ? "Propagation on" : "Explore propagation"}
          </Button>
          <Button variant="outline" onClick={resetView}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Relationships" value={totals?.total} loading={totalsQuery.isLoading} />
        <Metric label="Measured" value={totals?.measured} loading={totalsQuery.isLoading} tone="text-emerald-300" />
        <Metric label="Unvalidated" value={totals?.unvalidated} loading={totalsQuery.isLoading} tone="text-amber-300" />
        <Metric label="Insufficient evidence" value={totals?.insufficient} loading={totalsQuery.isLoading} tone="text-amber-300" />
        <Metric label="Refuted" value={totals?.refuted} loading={totalsQuery.isLoading} tone="text-rose-300" />
      </div>

      <Card className="border-border/80 bg-card/70">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(140px,0.7fr))]">
          <div className="relative min-w-0">
            <label htmlFor="graph-search" className="mb-1.5 block text-xs font-medium text-muted-foreground">Focus node</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="graph-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") focusSearch();
                  }}
                  className="pl-9"
                  placeholder="Country, domain, company, system…"
                  autoComplete="off"
                />
              </div>
              <Button variant="secondary" size="icon" onClick={focusSearch} disabled={searchMatches.length === 0} aria-label="Focus first matching graph node">
                <Focus className="h-4 w-4" />
              </Button>
            </div>
            {search.trim() && searchMatches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                {searchMatches.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      setSelectedEdgeId(null);
                      setSearch(node.label);
                    }}
                  >
                    <span className="truncate">{node.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{titleCase(node.kind)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Control label="Evidence">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={evidenceFilter}
              onChange={(event) => setEvidenceFilter(event.target.value as EvidenceFilter)}
            >
              <option value="measured">Measured only</option>
              <option value="all">All evidence states</option>
              <option value="unvalidated">Unvalidated</option>
              <option value="insufficient_evidence">Insufficient evidence</option>
              <option value="refuted">Refuted</option>
            </select>
          </Control>

          <Control label="Relationship">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={relationFilter}
              onChange={(event) => setRelationFilter(event.target.value)}
            >
              <option value="all">All relationship types</option>
              {relationTypes.map((relation) => (
                <option key={relation} value={relation}>{titleCase(relation)}</option>
              ))}
            </select>
          </Control>

          <Control label={`Minimum current weight · ${minWeight.toFixed(2)}`}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={minWeight}
              onChange={(event) => setMinWeight(Number(event.target.value))}
              className="h-10 w-full accent-primary"
            />
          </Control>

          <Control label="Exploration depth">
            <div className="grid h-10 grid-cols-3 overflow-hidden rounded-md border border-input">
              {[1, 2, 3].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHops(value)}
                  className={value === hops ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}
                >
                  {value} hop{value > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </Control>
        </CardContent>
      </Card>

      {shockMode && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
          <Waves className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            <strong>Directed reachability mode:</strong> highlighted nodes are downstream through directed graph edges within {hops} hop{hops > 1 ? "s" : ""}. Undirected correlation edges are deliberately excluded, so reachability is never presented as proven causality.
          </p>
        </div>
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 overflow-hidden border-border/80 bg-card/70">
          <CardHeader className="border-b border-border/60 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Evidence network
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {focusGraph.nodes.length} nodes · {focusGraph.edges.length} visible edges · {visibleMeasured} measured
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                <LegendDot color="hsl(var(--chart-1))" label="Country domain" />
                <LegendDot color="hsl(var(--chart-2))" label="System" />
                <LegendDot color="hsl(var(--chart-3))" label="Entity" />
                <span>thicker line = stronger current evidence</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {edgesQuery.isLoading || entityLabelsQuery.isLoading ? (
              <div className="p-4"><Skeleton className="h-[610px] w-full" /></div>
            ) : edgesQuery.error ? (
              <div className="p-6 text-sm text-destructive">Unable to load graph evidence: {(edgesQuery.error as Error).message}</div>
            ) : focusGraph.nodes.length === 0 ? (
              <div className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
                No relationships match the current evidence filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block min-w-[760px] w-full" role="img" aria-label="Interactive AICIS planetary evidence graph">
                  <defs>
                    <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
                      <path d="M0,0 L7,3.5 L0,7 Z" fill="hsl(var(--muted-foreground))" />
                    </marker>
                    <filter id="selected-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>

                  <g>
                    {focusGraph.edges.map((edge) => {
                      const sourceId = nodeId(edge.subject_kind, edge.subject_key);
                      const targetId = nodeId(edge.object_kind, edge.object_key);
                      const source = renderNodeMap.get(sourceId);
                      const target = renderNodeMap.get(targetId);
                      if (!source || !target) return null;
                      const weight = Math.max(0.05, Math.min(1, edgeWeight(edge)));
                      const active = selectedEdgeId === edge.id;
                      const shockActive = shockMode && shockRadius.has(sourceId) && shockRadius.has(targetId) && (shockRadius.get(targetId) ?? 99) > (shockRadius.get(sourceId) ?? 99);
                      const opacity = active ? 1 : shockMode ? (shockActive ? 0.95 : 0.12) : edge.evidence_status === "measured" ? 0.62 : 0.28;
                      const path = curvePath(source, target, edge.id);
                      return (
                        <g key={edge.id}>
                          <path
                            d={path}
                            fill="none"
                            stroke={shockActive ? "hsl(var(--primary))" : edge.evidence_status === "refuted" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
                            strokeWidth={active ? 5 : 1.2 + weight * 4.2}
                            strokeOpacity={opacity}
                            strokeDasharray={edge.evidence_status === "measured" ? undefined : "7 6"}
                            markerEnd={edge.direction === "undirected" ? undefined : "url(#graph-arrow)"}
                          />
                          <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="16"
                            className="cursor-pointer"
                            onClick={() => setSelectedEdgeId(edge.id)}
                          >
                            <title>{`${formatNodeLabel(edge.subject_kind, edge.subject_key, entityLabels)} ${titleCase(edge.relation_type)} ${formatNodeLabel(edge.object_kind, edge.object_key, entityLabels)}`}</title>
                          </path>
                        </g>
                      );
                    })}
                  </g>

                  <g>
                    {focusGraph.nodes.map((node) => {
                      const selected = node.id === selectedNodeId;
                      const shockHop = shockRadius.get(node.id);
                      const dimmed = shockMode && shockHop === undefined;
                      return (
                        <g
                          key={node.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Focus ${node.label}`}
                          className="cursor-pointer outline-none"
                          opacity={dimmed ? 0.22 : 1}
                          onClick={() => {
                            setSelectedNodeId(node.id);
                            setSelectedEdgeId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedNodeId(node.id);
                              setSelectedEdgeId(null);
                            }
                          }}
                        >
                          {shockHop !== undefined && shockMode && (
                            <circle cx={node.x} cy={node.y} r={node.radius + 8} fill="none" stroke="hsl(var(--primary))" strokeOpacity={0.4} strokeWidth="2" />
                          )}
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={node.radius}
                            fill={nodeColor(node.kind)}
                            fillOpacity={selected ? 0.95 : 0.72}
                            stroke={selected ? "hsl(var(--foreground))" : "hsl(var(--background))"}
                            strokeWidth={selected ? 3 : 2}
                            filter={selected ? "url(#selected-glow)" : undefined}
                          />
                          <text x={node.x} y={node.y + node.radius + 15} textAnchor="middle" fontSize="11" fontWeight={selected ? 700 : 500} fill="hsl(var(--foreground))">
                            {compactLabel(node.label)}
                          </text>
                          {shockMode && shockHop !== undefined && shockHop > 0 && (
                            <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="hsl(var(--primary-foreground))">
                              +{shockHop}
                            </text>
                          )}
                          <title>{`${node.label} · ${titleCase(node.kind)} · ${node.degree} connections`}</title>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-4">
          {selectedEdge ? (
            <EdgeInspector edge={selectedEdge} entityLabels={entityLabels} onClose={() => setSelectedEdgeId(null)} />
          ) : selectedNode ? (
            <NodeInspector
              node={selectedNode}
              connections={topConnections}
              entityLabels={entityLabels}
              shockHopCount={shockMode ? Math.max(0, shockRadius.size - 1) : null}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                setSelectedEdgeId(null);
              }}
              onSelectEdge={setSelectedEdgeId}
            />
          ) : null}

          <Card className="border-border/80 bg-card/70">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-primary" />Epistemic guardrail</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs leading-5 text-muted-foreground">
              <p>Measured edges are visually solid. Unvalidated, insufficient, or refuted evidence is never made to look equivalent to verified evidence.</p>
              <p>Temporal decay reduces the current weight of relationships as their evidence ages.</p>
              <p>Propagation mode shows directed graph reachability only. It does not claim that every reachable node will be causally affected.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, loading, tone }: { label: string; value?: number; loading: boolean; tone?: string }) {
  return (
    <Card className="border-border/70 bg-card/60">
      <CardContent className="p-3 md:p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="mt-2 h-7 w-20" /> : <p className={`mt-1 text-xl font-semibold ${tone ?? ""}`}>{(value ?? 0).toLocaleString()}</p>}
      </CardContent>
    </Card>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>{children}</div>;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>;
}

function NodeInspector({
  node,
  connections,
  entityLabels,
  shockHopCount,
  onSelectNode,
  onSelectEdge,
}: {
  node: GraphNode;
  connections: GraphRelationship[];
  entityLabels: Map<string, string>;
  shockHopCount: number | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  return (
    <Card className="border-border/80 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: nodeColor(node.kind) }} />
          <div className="min-w-0">
            <CardTitle className="break-words text-base">{node.label}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{titleCase(node.kind)} · {node.degree} graph connections</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <MiniMetric label="Weighted degree" value={node.weightedDegree.toFixed(3)} icon={<Activity className="h-3.5 w-3.5" />} />
          <MiniMetric label="Downstream" value={shockHopCount === null ? "—" : shockHopCount.toString()} icon={<Waves className="h-3.5 w-3.5" />} />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Strongest connections</p>
          <div className="space-y-1.5">
            {connections.length === 0 ? (
              <p className="text-xs text-muted-foreground">No relationships match the current filters.</p>
            ) : connections.map((edge) => {
              const sourceId = nodeId(edge.subject_kind, edge.subject_key);
              const targetId = nodeId(edge.object_kind, edge.object_key);
              const neighborIsTarget = sourceId === node.id;
              const neighborId = neighborIsTarget ? targetId : sourceId;
              const neighborLabel = neighborIsTarget
                ? formatNodeLabel(edge.object_kind, edge.object_key, entityLabels)
                : formatNodeLabel(edge.subject_kind, edge.subject_key, entityLabels);
              return (
                <div key={edge.id} className="rounded-md border border-border/70 bg-background/35 p-2.5">
                  <button type="button" className="w-full text-left" onClick={() => onSelectNode(neighborId)}>
                    <p className="truncate text-xs font-medium">{neighborLabel}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{neighborIsTarget ? "→" : "←"} {titleCase(edge.relation_type)} · w {formatNumber(edge.decayed_weight)}</p>
                  </button>
                  <button type="button" className="mt-1 text-[10px] font-medium text-primary hover:underline" onClick={() => onSelectEdge(edge.id)}>Inspect evidence</button>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EdgeInspector({ edge, entityLabels, onClose }: { edge: GraphRelationship; entityLabels: Map<string, string>; onClose: () => void }) {
  const subject = formatNodeLabel(edge.subject_kind, edge.subject_key, entityLabels);
  const object = formatNodeLabel(edge.object_kind, edge.object_key, entityLabels);
  return (
    <Card className="border-primary/25 bg-card/80">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={statusClasses(edge.evidence_status)}>{titleCase(edge.evidence_status)}</Badge>
              <Badge variant="outline">{edge.direction}</Badge>
            </div>
            <CardTitle className="text-base leading-6">{subject} <span className="text-primary">{titleCase(edge.relation_type)}</span> {object}</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Node</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <MiniMetric label="Evidence strength" value={formatNumber(edge.evidence_strength)} icon={<Activity className="h-3.5 w-3.5" />} />
          <MiniMetric label="Current weight" value={formatNumber(edge.decayed_weight)} icon={<Clock3 className="h-3.5 w-3.5" />} />
          <MiniMetric label="Confidence" value={formatNumber(edge.confidence)} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
          <MiniMetric label="Sample n" value={edge.sample_size?.toLocaleString() ?? "—"} icon={<GitBranch className="h-3.5 w-3.5" />} />
        </div>
        <Detail label="Method" value={titleCase(edge.method)} />
        <Detail label="Source table" value={edge.source_table} mono />
        <Detail label="Evidence age" value={edge.evidence_age_days === null ? "—" : `${Math.round(edge.evidence_age_days)} days`} />
        <Detail label="Decay half-life" value={`${edge.decay_half_life_days} days`} />
        <Detail label="Observed from" value={formatDate(edge.observed_from)} />
        <Detail label="Observed to" value={formatDate(edge.observed_to)} />
        <Detail label="Last measured" value={formatDate(edge.last_measured_at)} />
        {edge.country_count !== null && <Detail label="Countries" value={edge.country_count.toLocaleString()} />}
        {edge.window_days !== null && <Detail label="Measurement window" value={`${edge.window_days} days`} />}
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/35 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 break-words text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
