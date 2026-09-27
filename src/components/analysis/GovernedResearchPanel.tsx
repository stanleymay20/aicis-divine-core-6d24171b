import { FormEvent, useEffect, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Database,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfidenceBadge } from "@/components/aicis/trust/ConfidenceBadge";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type ResearchSeverity = "low" | "medium" | "high" | "critical" | "unknown";

type GovernedResearchResult = {
  question: string;
  briefing: string | null;
  severity: ResearchSeverity;
  confidence: number | null;
  dataCompleteness: number | null;
  evidenceCount: number | null;
  sources: string[];
  divisions: string[];
  truthFloor: boolean | null;
  modelMemoryFallback: boolean | null;
  provider: string | null;
  model: string | null;
  generatedAt: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const severityOf = (value: unknown): ResearchSeverity =>
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "critical"
    ? value
    : "unknown";

const severityClass = (severity: ResearchSeverity) => {
  if (severity === "critical") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (severity === "high") {
    return "border-orange-500/30 bg-orange-500/10 text-orange-500";
  }
  if (severity === "medium") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-500";
  }
  if (severity === "low") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  }
  return "border-border text-muted-foreground";
};

export const GovernedResearchPanel = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedEntity } = useIntelligenceOS();
  const activeQuestion = searchParams.get("question")?.trim() ?? "";

  const [question, setQuestion] = useState(activeQuestion);
  const [result, setResult] = useState<GovernedResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setQuestion(activeQuestion);
  }, [activeQuestion]);

  const runResearch = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || running) return;

    const contextLine = selectedEntity
      ? `Selected intelligence context: ${selectedEntity.type} | ${selectedEntity.name} | ${selectedEntity.id}. Use this context only where supported by stored evidence.`
      : "";

    const researchQuery = contextLine
      ? `${trimmed}\n\n${contextLine}`
      : trimmed;

    if (researchQuery.length > 4000) {
      setError("Question plus selected context exceeds the 4,000-character research limit.");
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.set("question", trimmed);
    if (selectedEntity) {
      next.set("entity", `${selectedEntity.type}:${selectedEntity.id}`);
    }
    setSearchParams(next, { replace: true });

    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "aicis-intelligence",
        {
          body: {
            query: researchQuery,
          },
        },
      );

      if (invokeError) throw invokeError;

      const response = asRecord(data);
      if (typeof response.error === "string") {
        throw new Error(response.error);
      }

      const metadata = asRecord(response.metadata);
      const briefing =
        typeof response.briefing === "string"
          ? response.briefing
          : typeof response.response === "string"
            ? response.response
            : typeof response.summary === "string"
              ? response.summary
              : null;

      const evidenceCount = finiteNumber(metadata.evidence_count);

      setResult({
        question: trimmed,
        briefing,
        severity:
          evidenceCount === 0 ? "unknown" : severityOf(response.severity),
        confidence: finiteNumber(response.confidence),
        dataCompleteness: finiteNumber(response.dataCompleteness),
        evidenceCount,
        sources: stringArray(response.sources),
        divisions: stringArray(response.divisions),
        truthFloor:
          typeof metadata.truth_floor === "boolean"
            ? metadata.truth_floor
            : null,
        modelMemoryFallback:
          typeof metadata.model_memory_fallback === "boolean"
            ? metadata.model_memory_fallback
            : null,
        provider:
          typeof metadata.provider === "string" ? metadata.provider : null,
        model: typeof metadata.model === "string" ? metadata.model : null,
        generatedAt: new Date().toISOString(),
      });
    } catch (researchError) {
      setError(
        researchError instanceof Error
          ? researchError.message
          : "Evidence research could not be completed.",
      );
    } finally {
      setRunning(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runResearch(question);
  };

  return (
    <Card className="border-primary/20 bg-primary/[0.025]">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-primary" />
            Evidence research
          </CardTitle>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            Stored evidence only
          </Badge>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Runs the sovereign AICIS research function against stored evidence.
          Model-memory fallback is prohibited by the backend truth floor.
        </p>

        {selectedEntity && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2.5 py-2 text-[10px]">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              Context
            </span>
            <Badge variant="secondary" className="max-w-full truncate text-[10px]">
              {selectedEntity.type} · {selectedEntity.name}
            </Badge>
            <span className="text-muted-foreground">
              Sent with the question; used only where stored evidence supports it.
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask an evidence-grounded intelligence question…"
            maxLength={3600}
            disabled={running}
            aria-label="Evidence research question"
            className="flex-1"
          />
          <Button type="submit" disabled={running || !question.trim()} className="gap-2">
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {running ? "Researching…" : "Run evidence research"}
          </Button>
        </form>

        {activeQuestion && !result && !running && !error && (
          <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            Question carried from Ask AICIS. Review or edit it, then run the evidence research.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Research unavailable</div>
              <div className="mt-1 text-destructive/90">{error}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                No fallback answer was generated in the interface.
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("font-mono text-[10px] uppercase", severityClass(result.severity))}
              >
                Severity · {result.severity}
              </Badge>
              <ConfidenceBadge value={result.confidence ?? undefined} />
              <Badge variant="outline" className="font-mono text-[10px]">
                <Database className="mr-1 h-3 w-3" />
                {result.evidenceCount == null
                  ? "Evidence rows unavailable"
                  : `${result.evidenceCount} evidence rows`}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                Category coverage ·{" "}
                {result.dataCompleteness == null
                  ? "UNKNOWN"
                  : `${Math.round(result.dataCompleteness * 100)}%`}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px]",
                  result.truthFloor === true
                    ? "border-emerald-500/30 text-emerald-500"
                    : "text-muted-foreground",
                )}
              >
                {result.truthFloor === true
                  ? "TRUTH FLOOR CONFIRMED"
                  : "TRUTH-FLOOR METADATA UNAVAILABLE"}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px]",
                  result.modelMemoryFallback === false
                    ? "border-emerald-500/30 text-emerald-500"
                    : result.modelMemoryFallback === true
                      ? "border-destructive/30 text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {result.modelMemoryFallback === false
                  ? "MODEL MEMORY OFF"
                  : result.modelMemoryFallback === true
                    ? "MODEL MEMORY FALLBACK REPORTED"
                    : "MODEL-MEMORY STATUS UNKNOWN"}
              </Badge>
            </div>

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Research question
              </div>
              <p className="text-sm font-medium">{result.question}</p>
            </div>

            <div className="rounded-lg border border-border/70 bg-background/60 p-4">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Evidence-grounded briefing
              </div>
              {result.briefing ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {result.briefing}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The research endpoint returned no briefing text.
                </p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/70 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Source tables
                </div>
                {result.sources.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.sources.map((source) => (
                      <Badge key={source} variant="outline" className="font-mono text-[10px]">
                        {source}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No source tables were returned.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border/70 p-3 text-xs">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Research runtime
                </div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>
                    Response generated ·{" "}
                    <span className="font-mono text-foreground">{result.generatedAt}</span>
                  </div>
                  <div>
                    Divisions ·{" "}
                    <span className="text-foreground">
                      {result.divisions.length
                        ? result.divisions.join(", ")
                        : "Unavailable"}
                    </span>
                  </div>
                  {(result.provider || result.model) && (
                    <div>
                      Synthesis ·{" "}
                      <span className="text-foreground">
                        {[result.provider, result.model].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
