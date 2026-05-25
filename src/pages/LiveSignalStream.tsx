/**
 * LiveSignalStream — relevance-aware real-time event stream.
 * Split into ./components/live-signal-stream/* for maintainability.
 * No business logic changes from original monolith.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Radio, ShieldAlert, Globe2, Pause, Play, Filter, Sparkles, Eye, EyeOff } from "lucide-react";
import { BreakingNowLane } from "@/components/live/BreakingNowLane";
import { StreamingHealthPanel } from "@/components/live/StreamingHealthPanel";
import { PipelineStageLatencyPanel } from "@/components/live/PipelineStageLatencyPanel";
import { FirehoseHealthGrid } from "@/components/live/FirehoseHealthGrid";
import { type OperationalFilter, type RelevanceScore, type Signal, type VisibilityTab, WINDOW_MS } from "@/components/live-signal-stream/types";
import { applyRelevance, mergeAndPrune } from "@/components/live-signal-stream/helpers";
import { FilterPill, StatTile } from "@/components/live-signal-stream/atoms";
import { SignalRow } from "@/components/live-signal-stream/SignalRow";

export default function LiveSignalStream() {
  const queryClient = useQueryClient();
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<OperationalFilter>("all");
  const [visibility, setVisibility] = useState<VisibilityTab>("important");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tickCount, setTickCount] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const auth = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
    staleTime: 60_000,
  });

  const initial = useQuery({
    queryKey: ["live-stream-initial"],
    queryFn: async (): Promise<Signal[]> => {
      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from("global_signals")
        .select("id,title,summary,category,primary_source,canonical_source_name,ingestion_source,source_trust_tier,confidence_score,impact_score,urgency_score,affected_countries,first_detected_at,ingested_at,canonical_event_status,corroboration_count,propaganda_risk_score,source_credibility_score,confidence_explanation,source_language,translated_title,translation_status,language_tier,script_detected,country_extraction_method,country_extraction_confidence,detection_latency_seconds,last_pipeline_stage,novelty_score")
        .gte("first_detected_at", since)
        .order("first_detected_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Signal[];
    },
    staleTime: 15_000,
  });

  const signalIds = useMemo(() => signals.map((s) => s.id), [signals]);

  const relevanceScores = useQuery({
    queryKey: ["live-signal-relevance", auth.data?.id, signalIds.join(",")],
    enabled: !!auth.data?.id && signalIds.length > 0,
    queryFn: async (): Promise<RelevanceScore[]> => {
      const { data, error } = await (supabase as any)
        .from("signal_relevance_scores")
        .select("signal_id,relevance_score,relevance_tier,relevance_reason,computed_at")
        .eq("user_id", auth.data!.id)
        .in("signal_id", signalIds);
      if (error) throw error;
      return (data ?? []) as RelevanceScore[];
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const enrichedSignals = useMemo(
    () => applyRelevance(signals, relevanceScores.data),
    [signals, relevanceScores.data],
  );

  useEffect(() => {
    if (!initial.data) return;
    const fresh = initial.data.filter(r => !seen.current.has(r.id));
    if (fresh.length === 0) return;
    fresh.forEach(r => seen.current.add(r.id));
    setSignals(prev => mergeAndPrune([...prev, ...fresh]));
  }, [initial.data]);

  useEffect(() => {
    if (paused) return;
    const channel = supabase
      .channel("live-global-signals")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_signals" },
        (payload) => {
          const row = payload.new as Signal;
          if (!row || seen.current.has(row.id)) return;
          seen.current.add(row.id);
          setSignals(prev => mergeAndPrune([row, ...prev]));
          setTickCount(c => c + 1);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [paused]);

  useEffect(() => {
    const id = setInterval(() => setSignals(prev => mergeAndPrune(prev)), 30_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    return enrichedSignals.filter(s => {
      if (!showDuplicates && s.canonical_event_status === "duplicate") return false;
      if (filter === "recovery" && s.ingestion_source !== "detection_audit_recovery") return false;
      if (filter === "high_impact" && (s.impact_score ?? 0) < 65) return false;

      if (visibility === "raw") return true;
      if (visibility === "critical") return s.relevance_tier === "critical";
      if (visibility === "important") return s.relevance_tier === "critical" || s.relevance_tier === "important";
      if (visibility === "monitor") return s.relevance_tier === "monitor";
      if (visibility === "discovery") return s.relevance_tier === "discovery";
      if (visibility === "hidden") return s.relevance_tier === "hidden";
      return true;
    });
  }, [enrichedSignals, filter, showDuplicates, visibility]);

  const tierCounts = useMemo(() => {
    return enrichedSignals.reduce((acc: Record<string, number>, s) => {
      const t = s.relevance_tier ?? "hidden";
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
  }, [enrichedSignals]);

  const feedback = useMutation({
    mutationFn: async ({ signalId, type, context }: { signalId: string; type: string; context?: any }) => {
      if (!auth.data?.id) throw new Error("Sign in required to save feedback.");
      const { error } = await (supabase as any).from("user_signal_feedback").insert({
        user_id: auth.data.id,
        signal_id: signalId,
        feedback_type: type,
        feedback_context: context ?? {},
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-signal-relevance"] }),
  });

  const dupeCount = enrichedSignals.filter(s => s.canonical_event_status === "duplicate").length;
  const recoveryCount = enrichedSignals.filter(s => s.ingestion_source === "detection_audit_recovery").length;
  const sourceSet = new Set(enrichedSignals.map(s => s.canonical_source_name || s.primary_source).filter(Boolean));
  const countrySet = new Set(enrichedSignals.flatMap(s => s.affected_countries ?? []));

  return (
    <div className="container mx-auto py-6 max-w-6xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Radio className="h-7 w-7 text-emerald-400 animate-pulse" /> Live Signal Stream
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Relevance-aware real-time tail of the planetary nervous system. Raw firehose remains available for analysts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={paused ? "default" : "outline"}
            onClick={() => setPaused(p => !p)}
            className="min-h-[36px]"
          >
            {paused ? <><Play className="h-4 w-4 mr-1" /> Resume</> : <><Pause className="h-4 w-4 mr-1" /> Pause</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={<Activity className="h-4 w-4" />} label="Signals (30m)" value={enrichedSignals.length.toString()} accent="text-emerald-300" />
        <StatTile icon={<ShieldAlert className="h-4 w-4" />} label="Critical/Important" value={((tierCounts.critical ?? 0) + (tierCounts.important ?? 0)).toString()} accent="text-orange-300" />
        <StatTile icon={<Globe2 className="h-4 w-4" />} label="Countries touched" value={countrySet.size.toString()} accent="text-sky-300" />
        <StatTile icon={<Radio className="h-4 w-4" />} label="Distinct sources" value={sourceSet.size.toString()} accent="text-violet-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakingNowLane />
        <StreamingHealthPanel />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PipelineStageLatencyPanel />
        <FirehoseHealthGrid />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <FilterPill active={visibility === "critical"} onClick={() => setVisibility("critical")}>Critical ({tierCounts.critical ?? 0})</FilterPill>
          <FilterPill active={visibility === "important"} onClick={() => setVisibility("important")}>Important+ ({(tierCounts.critical ?? 0) + (tierCounts.important ?? 0)})</FilterPill>
          <FilterPill active={visibility === "monitor"} onClick={() => setVisibility("monitor")}>Monitor ({tierCounts.monitor ?? 0})</FilterPill>
          <FilterPill active={visibility === "discovery"} onClick={() => setVisibility("discovery")}>Discovery ({tierCounts.discovery ?? 0})</FilterPill>
          <FilterPill active={visibility === "hidden"} onClick={() => setVisibility("hidden")}><EyeOff className="h-3 w-3 inline mr-1" />Hidden ({tierCounts.hidden ?? 0})</FilterPill>
          <FilterPill active={visibility === "raw"} onClick={() => setVisibility("raw")}><Eye className="h-3 w-3 inline mr-1" />Raw Stream</FilterPill>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>All sources</FilterPill>
          <FilterPill active={filter === "recovery"} onClick={() => setFilter("recovery")}>Recovered only ({recoveryCount})</FilterPill>
          <FilterPill active={filter === "high_impact"} onClick={() => setFilter("high_impact")}>High impact (≥65)</FilterPill>
          <FilterPill active={showDuplicates} onClick={() => setShowDuplicates(v => !v)}>
            {showDuplicates ? "Hiding none" : `Show duplicate reports (${dupeCount})`}
          </FilterPill>
          {tickCount > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {tickCount} live insert{tickCount === 1 ? "" : "s"} since page load
            </span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${paused ? "bg-zinc-500" : "bg-emerald-400 animate-pulse"}`} />
            {paused ? "Stream paused" : visibility === "raw" ? "Raw analyst stream" : "Relevance-ranked stream"}
          </CardTitle>
          <CardDescription>
            {filtered.length === 0
              ? initial.isLoading ? "Loading…" : "No signals in this relevance tier. Try Discovery or Raw Stream."
              : `Showing ${filtered.length} of ${enrichedSignals.length} rows in the rolling 30-minute window.`}
            {relevanceScores.data && relevanceScores.data.length < signalIds.length && auth.data?.id && (
              <span className="ml-1 text-amber-400">Some rows are using fallback relevance until the scorer catches up.</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto pr-2">
          {filtered.map(s => (
            <SignalRow
              key={s.id}
              signal={s}
              expanded={expanded === s.id}
              visibility={visibility}
              onToggleExpand={() => setExpanded(expanded === s.id ? null : s.id)}
              feedbackDisabled={!auth.data?.id || feedback.isPending}
              onFeedback={(type, context) => feedback.mutate({ signalId: s.id, type, context })}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
