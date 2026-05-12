/**
 * LiveSignalStream — relevance-aware real-time event stream.
 *
 * Phase 1 upgrade:
 * - Default visibility becomes Critical + Important relevance tiers.
 * - Monitor / Discovery / Raw Stream remain available for analysts.
 * - Scored relevance from signal_relevance_scores is preferred.
 * - If a signal has not been scored yet, the UI computes a safe fallback tier from urgency/impact/confidence/novelty.
 * - Feedback buttons write user_signal_feedback for the learning loop.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Radio, ShieldAlert, Globe2, Pause, Play, Filter, Sparkles, Eye, EyeOff, ThumbsUp, ThumbsDown, Bookmark, Siren } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { BreakingNowLane } from "@/components/live/BreakingNowLane";
import { StreamingHealthPanel } from "@/components/live/StreamingHealthPanel";
import { PipelineStageLatencyPanel } from "@/components/live/PipelineStageLatencyPanel";
import { FirehoseHealthGrid } from "@/components/live/FirehoseHealthGrid";

type RelevanceTier = "critical" | "important" | "monitor" | "discovery" | "hidden";
type VisibilityTab = RelevanceTier | "raw";
type OperationalFilter = "all" | "recovery" | "high_impact";

type RelevanceScore = {
  signal_id: string;
  relevance_score: number;
  relevance_tier: RelevanceTier;
  relevance_reason: any;
  computed_at: string;
};

type Signal = {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  primary_source: string | null;
  canonical_source_name: string | null;
  ingestion_source: string | null;
  source_trust_tier: string | null;
  confidence_score: number | null;
  impact_score: number | null;
  urgency_score: number | null;
  affected_countries: string[] | null;
  first_detected_at: string;
  ingested_at: string | null;
  canonical_event_status: string | null;
  corroboration_count: number | null;
  propaganda_risk_score: number | null;
  source_credibility_score: number | null;
  confidence_explanation: any;
  source_language: string | null;
  translated_title: string | null;
  translation_status: string | null;
  language_tier: string | null;
  script_detected: string | null;
  country_extraction_method: string | null;
  country_extraction_confidence: number | null;
  detection_latency_seconds: number | null;
  last_pipeline_stage: string | null;
  novelty_score?: number | null;
  relevance_score?: number | null;
  relevance_tier?: RelevanceTier | null;
  relevance_reason?: any;
  relevance_computed_at?: string | null;
  relevance_is_fallback?: boolean;
};

const WINDOW_MS = 30 * 60 * 1000;

function tierColor(tier: string | null) {
  switch (tier) {
    case "tier_1": return "bg-emerald-500/15 text-emerald-300 border-emerald-700/50";
    case "tier_2": return "bg-sky-500/15 text-sky-300 border-sky-700/50";
    default:       return "bg-zinc-500/15 text-zinc-300 border-zinc-700/50";
  }
}

function relevanceBadgeColor(tier: RelevanceTier | null | undefined) {
  switch (tier) {
    case "critical": return "bg-red-500/15 text-red-300 border-red-700/50";
    case "important": return "bg-orange-500/15 text-orange-300 border-orange-700/50";
    case "monitor": return "bg-sky-500/15 text-sky-300 border-sky-700/50";
    case "discovery": return "bg-violet-500/15 text-violet-300 border-violet-700/50";
    case "hidden": return "bg-zinc-500/15 text-zinc-300 border-zinc-700/50";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function sourceBadge(s: Signal) {
  if (s.ingestion_source === "detection_audit_recovery") {
    return { label: "RECOVERED", className: "bg-amber-500/20 text-amber-200 border-amber-600/60" };
  }
  if (s.ingestion_source === "firecrawl_search") {
    return { label: "WEB SWEEP", className: "bg-violet-500/15 text-violet-200 border-violet-700/50" };
  }
  return { label: (s.ingestion_source || "wire").slice(0, 18), className: "bg-zinc-500/15 text-zinc-300 border-zinc-700/50" };
}

function tierFromScore(score: number): RelevanceTier {
  if (score >= 85) return "critical";
  if (score >= 70) return "important";
  if (score >= 55) return "monitor";
  if (score >= 40) return "discovery";
  return "hidden";
}

function fallbackRelevance(s: Signal): Pick<Signal, "relevance_score" | "relevance_tier" | "relevance_reason" | "relevance_is_fallback"> {
  const urgency = s.urgency_score ?? 0;
  const impact = s.impact_score ?? 0;
  const confidence = s.confidence_score ?? 0;
  const novelty = s.novelty_score ?? 50;
  const corrob = Math.min(100, Math.max(0, ((s.corroboration_count ?? 1) - 1) * 18));
  const sourceBoost = s.source_trust_tier === "tier_1" ? 8 : s.source_trust_tier === "tier_2" ? 4 : 0;
  const score = Math.max(
    0,
    Math.min(100, Math.round(impact * 0.28 + urgency * 0.28 + confidence * 0.18 + novelty * 0.12 + corrob * 0.08 + sourceBoost)),
  );
  const weakSignalProtected = novelty >= 85 || corrob >= 45 || (urgency >= 75 && impact >= 60);
  const finalScore = weakSignalProtected ? Math.max(score, 40) : score;
  return {
    relevance_score: finalScore,
    relevance_tier: tierFromScore(finalScore),
    relevance_is_fallback: true,
    relevance_reason: {
      formula_version: "ui_fallback_v1",
      explanation: weakSignalProtected
        ? "Discovery preserved because this is unusual, corroborated, or urgent even before user-specific scoring completes."
        : "Temporary operational relevance estimate until personalized scoring completes.",
      components: { urgency, impact, confidence, novelty, corroboration: corrob, source_boost: sourceBoost },
      weak_signal_protected: weakSignalProtected,
    },
  };
}

function applyRelevance(signals: Signal[], scores: RelevanceScore[] | undefined): Signal[] {
  const scoreMap = new Map((scores ?? []).map((s) => [s.signal_id, s]));
  return signals.map((signal) => {
    const scored = scoreMap.get(signal.id);
    if (scored) {
      return {
        ...signal,
        relevance_score: scored.relevance_score,
        relevance_tier: scored.relevance_tier,
        relevance_reason: scored.relevance_reason,
        relevance_computed_at: scored.computed_at,
        relevance_is_fallback: false,
      };
    }
    return { ...signal, ...fallbackRelevance(signal) };
  });
}

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

  // Seed state from initial fetch
  useEffect(() => {
    if (!initial.data) return;
    const fresh = initial.data.filter(r => !seen.current.has(r.id));
    if (fresh.length === 0) return;
    fresh.forEach(r => seen.current.add(r.id));
    setSignals(prev => mergeAndPrune([...prev, ...fresh]));
  }, [initial.data]);

  // Realtime subscription
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

  // Prune the window every 30s so old rows fall off without a refresh
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
          {filtered.map(s => {
            const badge = sourceBadge(s);
            const isRecovery = s.ingestion_source === "detection_audit_recovery";
            const isDupe = s.canonical_event_status === "duplicate";
            const conf = s.confidence_score ?? 0;
            const confColor = conf >= 75 ? "bg-emerald-500/15 text-emerald-300 border-emerald-700/50"
              : conf >= 50 ? "bg-sky-500/15 text-sky-300 border-sky-700/50"
              : "bg-amber-500/15 text-amber-300 border-amber-700/50";
            const isOpen = expanded === s.id;
            return (
              <div
                key={s.id}
                className={`rounded-md border p-3 transition-colors ${
                  isRecovery ? "border-amber-700/40 bg-amber-500/5"
                  : isDupe ? "border-border/40 bg-muted/10 opacity-75"
                  : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium leading-snug">
                      {s.translated_title || s.title}
                    </h3>
                    {s.translated_title && s.translated_title !== s.title && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 italic line-clamp-1">
                        {s.source_language && <span className="uppercase font-mono mr-1">[{s.source_language}]</span>}
                        {s.title}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <Badge variant="outline" className={relevanceBadgeColor(s.relevance_tier) + " text-[10px] font-mono"} title={s.relevance_is_fallback ? "Fallback relevance estimate" : "Personalized relevance score"}>
                      {s.relevance_tier}{typeof s.relevance_score === "number" ? ` ${s.relevance_score}` : ""}{s.relevance_is_fallback ? "*" : ""}
                    </Badge>
                    {s.source_language && s.source_language !== "en" && s.source_language !== "und" && (
                      <Badge variant="outline" className="bg-violet-500/15 text-violet-200 border-violet-700/50 text-[10px] uppercase font-mono">{s.source_language}</Badge>
                    )}
                    {isDupe && <Badge variant="outline" className="bg-zinc-500/15 text-zinc-300 border-zinc-700/50 text-[10px]">DUPE</Badge>}
                    <Badge variant="outline" className={badge.className + " text-[10px]"}>{badge.label}</Badge>
                    {s.source_trust_tier && (
                      <Badge variant="outline" className={tierColor(s.source_trust_tier) + " text-[10px]"}>
                        {s.source_trust_tier.replace("_", " ")}
                      </Badge>
                    )}
                    {typeof s.confidence_score === "number" && (
                      <Badge variant="outline" className={confColor + " text-[10px] font-mono"}>
                        {conf}% conf
                      </Badge>
                    )}
                  </div>
                </div>
                {s.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{s.summary}</p>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.category && <span className="text-foreground/70">{s.category}</span>}
                    {s.canonical_source_name && <span>· {s.canonical_source_name}</span>}
                    {(s.corroboration_count ?? 0) > 1 && <span>· {s.corroboration_count} sources</span>}
                    {(s.affected_countries?.length ?? 0) > 0 && (
                      <span>· {s.affected_countries!.slice(0, 4).join(", ")}{s.affected_countries!.length > 4 ? "…" : ""}</span>
                    )}
                    {s.country_extraction_method && (s.affected_countries?.length ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-300 border-amber-700/50" title={`country inferred (conf ${s.country_extraction_confidence ?? 0})`}>inferred</Badge>
                    )}
                    {s.script_detected && s.script_detected !== "Latn" && (
                      <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-300 border-violet-700/50">{s.script_detected}</Badge>
                    )}
                    {s.language_tier === "tier_3" && (
                      <Badge variant="outline" className="text-[10px] bg-zinc-500/10 text-zinc-300 border-zinc-700/50">low-resource</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {typeof s.impact_score === "number" && <span className="font-mono">imp {s.impact_score}</span>}
                    {typeof s.detection_latency_seconds === "number" && (
                      <span className="font-mono text-[10px] text-emerald-300/80" title="wire-to-ingest latency">
                        {s.detection_latency_seconds < 60 ? `${s.detection_latency_seconds}s` : `${Math.round(s.detection_latency_seconds/60)}m`} latency
                      </span>
                    )}
                    <span>{formatDistanceToNow(new Date(s.first_detected_at), { addSuffix: true })}</span>
                    <button onClick={() => setExpanded(isOpen ? null : s.id)} className="text-primary hover:underline">
                      {isOpen ? "hide" : "why?"}
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="space-y-2">
                    <WhyRelevantPanel signal={s} />
                    {s.confidence_explanation && <WhyTrustPanel signal={s} />}
                    <FeedbackRow
                      signal={s}
                      disabled={!auth.data?.id || feedback.isPending}
                      onFeedback={(type) => feedback.mutate({
                        signalId: s.id,
                        type,
                        context: {
                          relevance_tier: s.relevance_tier,
                          relevance_score: s.relevance_score,
                          visibility,
                          fallback: s.relevance_is_fallback,
                        },
                      })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function mergeAndPrune(rows: Signal[]): Signal[] {
  const cutoff = Date.now() - WINDOW_MS;
  const seenIds = new Set<string>();
  const kept: Signal[] = [];
  for (const r of rows) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    if (new Date(r.first_detected_at).getTime() < cutoff) continue;
    kept.push(r);
  }
  kept.sort((a, b) => new Date(b.first_detected_at).getTime() - new Date(a.first_detected_at).getTime());
  return kept.slice(0, 300);
}

function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`flex items-center gap-2 text-xs ${accent}`}>
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-2xl font-bold mt-1 font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-full border transition-colors min-h-[28px] ${
        active
          ? "bg-primary/15 border-primary text-primary"
          : "border-border text-muted-foreground hover:border-muted-foreground/50"
      }`}
    >
      {children}
    </button>
  );
}

const TIER_LABELS: Record<string, string> = {
  tier_1: "Tier 1 — Official / authoritative",
  tier_2: "Tier 2 — Major newswire",
  tier_3: "Tier 3 — Regional outlet",
  tier_4: "Tier 4 — General web / social",
};

function WhyRelevantPanel({ signal }: { signal: Signal }) {
  const exp = (signal.relevance_reason || {}) as Record<string, any>;
  const components = exp.components || {};
  const matches = exp.matches || {};
  return (
    <div className="mt-2 pt-2 border-t border-border/50 text-[11px] space-y-1.5">
      <div className="font-semibold text-foreground/80">Why relevant</div>
      <Row label="Visibility tier" value={`${signal.relevance_tier ?? "unknown"}${typeof signal.relevance_score === "number" ? ` · ${signal.relevance_score}/100` : ""}`} />
      {exp.explanation && <Row label="Reason" value={String(exp.explanation)} />}
      {signal.relevance_is_fallback && <Row label="Scoring mode" value="Fallback until personalized scorer catches up" />}
      {Object.keys(matches).some((k) => Array.isArray(matches[k]) && matches[k].length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(matches).map(([k, v]) => Array.isArray(v) && v.length > 0 ? (
            <Row key={k} label={k.replaceAll("_", " ")} value={v.slice(0, 4).join(", ")} />
          ) : null)}
        </div>
      )}
      <div className="mt-1 p-2 bg-muted/20 rounded font-mono text-[10px] text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-1">
        {Object.entries(components).slice(0, 8).map(([k, v]) => (
          <span key={k}>{k}: {String(v)}</span>
        ))}
      </div>
    </div>
  );
}

function WhyTrustPanel({ signal }: { signal: Signal }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const exp = (signal.confidence_explanation || {}) as Record<string, any>;
  const isDupe = exp.role === "duplicate";
  const distinct = Number(exp.distinct_sources ?? signal.corroboration_count ?? 1);
  const tier = String(exp.source_tier ?? signal.source_trust_tier ?? "tier_4");
  const tierLabel = TIER_LABELS[tier] || tier;
  const credibility = Number(exp.source_credibility ?? signal.source_credibility_score ?? 0);
  const propaganda = Number(exp.propaganda_risk ?? signal.propaganda_risk_score ?? 0);
  const official = Boolean(exp.official_source);
  const recency = exp.recency_factor != null ? Number(exp.recency_factor) : null;

  return (
    <div className="mt-2 pt-2 border-t border-border/50 text-[11px] space-y-1.5">
      <div className="font-semibold text-foreground/80">Why AICIS trusts this</div>
      {isDupe ? (
        <Row label="Role" value={`Duplicate of an earlier report${exp.similarity ? ` (similarity ${Math.round(Number(exp.similarity) * 100)}%)` : ""}`} />
      ) : (
        <Row label="Confirmed by" value={`${distinct} source${distinct === 1 ? "" : "s"}`} />
      )}
      <Row label="Source tier" value={tierLabel} />
      <Row label="Source credibility" value={`${credibility}/100`} />
      {official && <Row label="Official source" value="Yes" />}
      <Row label="Propaganda risk" value={`${propaganda}/100`} />
      {recency != null && <Row label="Recency factor" value={`${Math.round(recency * 100)}%`} />}

      <button
        onClick={() => setShowAdvanced(v => !v)}
        className="text-primary hover:underline text-[10px] mt-1"
      >
        {showAdvanced ? "Hide formula" : "Show scoring formula"}
      </button>
      {showAdvanced && (
        <div className="mt-1 p-2 bg-muted/20 rounded font-mono text-[10px] text-muted-foreground space-y-1">
          {exp.formula && <div>{String(exp.formula)}</div>}
          {exp.corroboration_boost != null && <div>corroboration_boost: +{exp.corroboration_boost}</div>}
          {exp.official_boost != null && <div>official_boost: +{exp.official_boost}</div>}
          {exp.propaganda_penalty != null && <div>propaganda_penalty: −{exp.propaganda_penalty}</div>}
        </div>
      )}
    </div>
  );
}

function FeedbackRow({ signal, disabled, onFeedback }: { signal: Signal; disabled: boolean; onFeedback: (type: string) => void }) {
  return (
    <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-2 flex-wrap text-[11px]">
      <span className="text-muted-foreground mr-1">Teach relevance:</span>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("important") }>
        <ThumbsUp className="h-3 w-3 mr-1" /> Important
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("not_relevant") }>
        <ThumbsDown className="h-3 w-3 mr-1" /> Not relevant
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("save") }>
        <Bookmark className="h-3 w-3 mr-1" /> Save
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("escalate") }>
        <Siren className="h-3 w-3 mr-1" /> Escalate
      </Button>
      {!disabled && signal.relevance_is_fallback && <span className="text-amber-400">fallback score</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground/80 text-right">{value}</span>
    </div>
  );
}
