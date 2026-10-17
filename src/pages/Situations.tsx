import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  GitMerge,
  Loader2,
  Radio,
  RefreshCw,
  Route,
  ShieldCheck,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSituationsV1 } from "@/hooks/useSituationsV1";
import type { SituationV1 } from "@/lib/situation-read-model-v1.mjs";
import { cn } from "@/lib/utils";

type Filter = "all" | "needs_review" | "review_conflict" | "outcome_observed";

const formatTime = (value: string | null) => {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
};

const reviewLabel = (state: SituationV1["review"]["state"]) => {
  switch (state) {
    case "confirmed": return "review confirmed";
    case "rejected": return "review rejected";
    case "unclear": return "review unclear";
    case "conflicted": return "review conflict";
    default: return "unreviewed";
  }
};

const operationalLabel = (state: SituationV1["operational"]["state"]) => {
  switch (state) {
    case "outcome_observed": return "operational outcome observed";
    case "action_recorded": return "action recorded";
    case "recorded": return "decision/outcome record";
    default: return "no linked operational record";
  }
};

const identityLabel = (state: SituationV1["identityStatus"]) => {
  switch (state) {
    case "verified_canonical_group": return "verified canonical group";
    case "unresolved_duplicate_candidate": return "duplicate identity unresolved";
    default: return "standalone signal";
  }
};

const accessLabel = (state?: string) => {
  switch (state) {
    case "available": return "available";
    case "access_denied": return "blocked by auth/RLS";
    case "not_needed": return "not needed";
    default: return "unavailable";
  }
};

function TruthCell({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xs font-medium", warning && "text-amber-400")}>{value}</div>
    </div>
  );
}

function SituationCard({ situation }: { situation: SituationV1 }) {
  const navigate = useNavigate();
  const corroboration = situation.corroboration.state === "established"
    ? `established · ${situation.corroboration.independentOriginCount ?? "?"} independent origin(s)`
    : situation.corroboration.state === "not_established"
      ? "not established"
      : "unknown";

  return (
    <Card className={cn("overflow-hidden", situation.review.state === "conflicted" && "border-amber-500/40")}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                {situation.category || "uncategorized"}
              </Badge>
              <Badge variant="secondary" className="text-[9px]">
                {identityLabel(situation.identityStatus)}
              </Badge>
              {situation.needsReview && (
                <Badge variant="outline" className="border-amber-500/40 text-[9px] text-amber-400">
                  needs review
                </Badge>
              )}
            </div>
            <CardTitle className="text-base leading-snug">{situation.title}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {situation.summary || "No governed summary available for this Situation."}
            </CardDescription>
          </div>
          <div className="text-right text-[10px] text-muted-foreground">
            <div>first detected</div>
            <div className="font-mono text-foreground/80">{formatTime(situation.firstDetectedAt)}</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <TruthCell label="Reports" value={String(situation.reportCount)} />
          <TruthCell
            label="Source identifiers"
            value={`${situation.sourceIdentifierCount} · not independence`}
            warning={situation.sourceIdentifierCount > 1 && situation.corroboration.state !== "established"}
          />
          <TruthCell label="Independent corroboration" value={corroboration} warning={situation.corroboration.state === "unknown"} />
          <TruthCell label="Source contradictions" value="unknown · not modeled in v1" warning />
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <TruthCell
            label="Signal trust screen"
            value={situation.signalTrustScore == null ? "unknown" : `${situation.signalTrustScore}/100 · not a probability`}
            warning={situation.signalTrustScore == null}
          />
          <TruthCell label="Routing review" value={`${reviewLabel(situation.review.state)} · ${situation.review.count} record(s)`} warning={situation.review.state === "conflicted" || situation.review.state === "unclear"} />
          <TruthCell label="Forecast" value="not linked · sealed scientific forecast required" warning />
        </div>

        <div className="rounded-md border border-border/60 bg-background/60 p-3 text-xs">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Evidence & affected context
          </div>
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            <div><span className="text-muted-foreground">Sources:</span> {situation.sourceIdentifiers.length > 0 ? situation.sourceIdentifiers.slice(0, 4).join(", ") : "unknown"}{situation.sourceIdentifiers.length > 4 ? ` +${situation.sourceIdentifiers.length - 4}` : ""}</div>
            <div><span className="text-muted-foreground">Countries:</span> {situation.affectedCountries.length > 0 ? situation.affectedCountries.join(", ") : "unknown"}</div>
            <div><span className="text-muted-foreground">Sectors:</span> {situation.affectedSectors.length > 0 ? situation.affectedSectors.join(", ") : "unknown"}</div>
            <div><span className="text-muted-foreground">Stakeholders:</span> {situation.affectedStakeholders.length > 0 ? situation.affectedStakeholders.join(", ") : "unknown"}</div>
          </div>
          {situation.uncertaintyNotes && (
            <div className="mt-2 border-t border-border/50 pt-2 text-amber-300">
              <span className="font-semibold">Uncertainty:</span> {situation.uncertaintyNotes}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {situation.operational.state === "outcome_observed" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <CircleHelp className="h-4 w-4" />
            )}
            <span>{operationalLabel(situation.operational.state)}</span>
            {situation.operational.state === "outcome_observed" && (
              <span className="text-[10px] text-muted-foreground">(not forecast resolution)</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/live-stream")}>Open source stream</Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/decision-ops")}>Decision operations</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Situations() {
  const [filter, setFilter] = useState<Filter>("all");
  const query = useSituationsV1({ days: 7, limit: 300 });

  const situations = useMemo(() => query.data?.situations ?? [], [query.data?.situations]);
  const filtered = useMemo(() => situations.filter((situation) => {
    if (filter === "needs_review") return situation.needsReview;
    if (filter === "review_conflict") return situation.review.state === "conflicted";
    if (filter === "outcome_observed") return situation.operational.state === "outcome_observed";
    return true;
  }), [filter, situations]);

  const counts = useMemo(() => ({
    review: situations.filter((situation) => situation.needsReview).length,
    conflicts: situations.filter((situation) => situation.review.state === "conflicted").length,
    corroborated: situations.filter((situation) => situation.corroboration.state === "established").length,
    outcomes: situations.filter((situation) => situation.operational.state === "outcome_observed").length,
  }), [situations]);

  const windowMeta = query.data?.window;
  const coverageState = windowMeta?.coverageState;
  const loadedRows = windowMeta?.returnedSignalRows ?? query.data?.sourceSignalCount ?? 0;
  const exactRows = windowMeta?.totalSignalRows;
  const coverageWarning = coverageState && coverageState !== "complete_window";
  const queueScope = coverageState === "complete_window" ? "current seven-day window" : "currently loaded sample";

  const coverageDescription = (() => {
    if (!windowMeta) return "Coverage unavailable until the signal read completes.";
    if (coverageState === "complete_window") {
      return `Complete ${windowMeta.lookbackDays}-day window · ${loadedRows} signal row(s).`;
    }
    if (coverageState === "capped_sample") {
      return `Capped recent sample · newest ${loadedRows} of ${exactRows ?? "unknown"} signal rows in the ${windowMeta.lookbackDays}-day lookback.`;
    }
    if (coverageState === "cap_reached_total_unknown") {
      return `Row cap reached · newest ${loadedRows} signal rows loaded; exact ${windowMeta.lookbackDays}-day total is unknown.`;
    }
    if (coverageState === "count_inconsistent") {
      return `Live count and row reads disagreed during concurrent ingestion; ${loadedRows} rows are loaded but completeness is not claimed.`;
    }
    return `${loadedRows} signal rows loaded; exact ${windowMeta.lookbackDays}-day total is unavailable, so completeness is not claimed.`;
  })();

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Route className="h-7 w-7 text-primary" /> Situations
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Deterministic read model over existing signal, review and operational outcome records. Unknown evidence stays unknown; this view does not create forecast probabilities or new source truth.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn("mr-1.5 h-4 w-4", query.isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Situations</div>
          <div className="mt-1 text-2xl font-bold">{situations.length}</div>
          <div className="text-[10px] text-muted-foreground">
            from {loadedRows} loaded signal rows{typeof exactRows === "number" ? ` · ${exactRows} in lookback` : ""}
          </div>
        </Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Needs review</div><div className="mt-1 text-2xl font-bold text-amber-400">{counts.review}</div><div className="text-[10px] text-muted-foreground">unreviewed, unclear, conflict, or identity issue</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Corroboration established</div><div className="mt-1 text-2xl font-bold text-emerald-400">{counts.corroborated}</div><div className="text-[10px] text-muted-foreground">only explicit existing confirmation</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Operational outcomes</div><div className="mt-1 text-2xl font-bold">{counts.outcomes}</div><div className="text-[10px] text-muted-foreground">not scientific forecast resolutions</div></Card>
      </div>

      {windowMeta && (
        <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-[11px] text-muted-foreground md:grid-cols-3">
          <div><span className="font-semibold text-foreground">Coverage:</span> {coverageDescription}</div>
          <div><span className="font-semibold text-foreground">Read batch latency:</span> {windowMeta.queryLatencyMs == null ? "unknown" : `${windowMeta.queryLatencyMs} ms`} <span className="text-[10px]">(client-observed, not DB execution time)</span></div>
          <div>
            <span className="font-semibold text-foreground">Read access:</span>{" "}
            count {accessLabel(query.data?.accessStates.exactCount)} · identity {accessLabel(query.data?.accessStates.identity)} · review {accessLabel(query.data?.accessStates.feedback)} · outcomes {accessLabel(query.data?.accessStates.operationalOutcome)}
          </div>
        </div>
      )}

      {coverageWarning && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-300">
              <AlertTriangle className="h-4 w-4" /> Lookback coverage is not exhaustive
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {coverageDescription} Counts and filters on this page describe the loaded rows only; they are not presented as totals for the full lookback unless exact count evidence proves completeness.
          </CardContent>
        </Card>
      )}

      {(query.error || (query.data?.dataGaps?.length ?? 0) > 0) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-300">
              <AlertTriangle className="h-4 w-4" /> Evidence gaps remain visible
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {query.error && <div>Situation query failed: {query.error instanceof Error ? query.error.message : "unknown error"}</div>}
            {query.data?.dataGaps?.map((gap) => <div key={gap}>• {gap}</div>)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4 text-primary" /> Situation queue · seven-day lookback</CardTitle>
              <CardDescription>{coverageDescription} Verified duplicate identity is reused when available; candidate duplicates are never silently collapsed.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant={filter === "all" ? "default" : "outline"} className="h-7 text-[10px]" onClick={() => setFilter("all")}>All</Button>
              <Button size="sm" variant={filter === "needs_review" ? "default" : "outline"} className="h-7 text-[10px]" onClick={() => setFilter("needs_review")}>Needs review ({counts.review})</Button>
              <Button size="sm" variant={filter === "review_conflict" ? "default" : "outline"} className="h-7 text-[10px]" onClick={() => setFilter("review_conflict")}><AlertTriangle className="mr-1 h-3 w-3" />Conflicts ({counts.conflicts})</Button>
              <Button size="sm" variant={filter === "outcome_observed" ? "default" : "outline"} className="h-7 text-[10px]" onClick={() => setFilter("outcome_observed")}><Target className="mr-1 h-3 w-3" />Outcomes ({counts.outcomes})</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              <GitMerge className="mx-auto mb-2 h-5 w-5" />
              No Situations match this filter in the {queueScope}.
            </div>
          ) : filtered.map((situation) => <SituationCard key={situation.id} situation={situation} />)}
        </CardContent>
      </Card>

      <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Situation v1 truth floor:</strong> source identifier count is descriptive, not source independence; source contradictions are not yet governed in this projection; the signal trust score is not a forecast probability; operational outcomes are not forecast resolutions; a configured lookback is not called exhaustive when the row cap or an unavailable count prevents proof; auth/RLS denial is not interpreted as an empty dataset; the forecast slot remains empty until a registered sealed forecast can be joined under the scientific protocol.
      </div>
    </div>
  );
}