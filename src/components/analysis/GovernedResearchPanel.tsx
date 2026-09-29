import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  ExternalLink,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Citation = {
  ref: string;
  domain: string | null;
  title: string;
  publisher: string | null;
  url: string | null;
  observedAt: string | null;
};

type Dispute = {
  topic: string;
  specialistA: string;
  positionA: string;
  specialistB: string;
  positionB: string;
};

type GovernedResearchResult = {
  taskId: string | null;
  question: string;
  executiveSummary: string | null;
  agreedPoints: string[];
  disputedPoints: Dispute[];
  preservedDissent: string[];
  strongestEvidence: string | null;
  weakestAssumption: string | null;
  missingEvidence: string[];
  nextVerificationStep: string | null;
  confidence: number | null;
  confidenceLower: number | null;
  confidenceUpper: number | null;
  degraded: boolean;
  degradationReason: string | null;
  provider: string | null;
  model: string | null;
  scopeLabel: string | null;
  domains: string[];
  citations: Citation[];
  generatedAt: string;
};

/** Prior turn kept for a future follow-up contract; sent only if the backend says it supports it. */
type PriorTurn = {
  taskId: string | null;
  question: string;
  summary: string | null;
  followUpSupported: boolean;
};

type PanelNotice =
  | { kind: "clarification"; message: string }
  | { kind: "not_ready"; message: string; missing: string[] }
  | { kind: "mfa_required"; message: string }
  | { kind: "error"; message: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const safeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

const scopeLabelOf = (geography: Record<string, unknown>): string | null => {
  if (geography.scope === "global") return "Global";
  const regions = Array.isArray(geography.regions)
    ? geography.regions.map((r) => str(asRecord(r).label)).filter(Boolean)
    : [];
  const countries = Array.isArray(geography.countries)
    ? geography.countries.map((c) => str(asRecord(c).name) ?? str(asRecord(c).iso3)).filter(Boolean)
    : [];
  const label = [...regions, ...countries].join(", ");
  return label || null;
};

const parseResult = (question: string, response: Record<string, unknown>): GovernedResearchResult => ({
  taskId: str(response.task_id),
  question,
  executiveSummary: str(response.executive_summary),
  agreedPoints: stringArray(response.agreed_points),
  disputedPoints: Array.isArray(response.disputed_points)
    ? response.disputed_points.map((d) => {
        const r = asRecord(d);
        return {
          topic: str(r.topic) ?? "Unspecified",
          specialistA: str(r.specialist_a) ?? "?",
          positionA: str(r.position_a) ?? "",
          specialistB: str(r.specialist_b) ?? "?",
          positionB: str(r.position_b) ?? "",
        };
      })
    : [],
  preservedDissent: stringArray(response.preserved_dissent),
  strongestEvidence: str(response.strongest_evidence),
  weakestAssumption: str(response.weakest_assumption),
  missingEvidence: stringArray(response.missing_evidence),
  nextVerificationStep: str(response.next_verification_step),
  confidence: finiteNumber(response.overall_confidence),
  confidenceLower: finiteNumber(response.confidence_lower),
  confidenceUpper: finiteNumber(response.confidence_upper),
  degraded: response.degraded === true,
  degradationReason: str(response.degradation_reason),
  provider: str(response.provider),
  model: str(response.model),
  scopeLabel: scopeLabelOf(asRecord(response.geography)),
  domains: stringArray(response.domains),
  citations: Array.isArray(response.citations)
    ? response.citations.map((c) => {
        const r = asRecord(c);
        return {
          ref: str(r.ref) ?? "",
          domain: str(r.domain),
          title: str(r.title) ?? "(untitled)",
          publisher: str(r.publisher),
          url: safeUrl(r.url),
          observedAt: str(r.observed_at),
        };
      })
    : [],
  generatedAt: new Date().toISOString(),
});

const Section = ({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "warn" }) => (
  <div className={cn("rounded-lg border p-3", tone === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-border/70")}>
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
    {children}
  </div>
);

const List = ({ items, empty }: { items: string[]; empty: string }) =>
  items.length ? (
    <ul className="list-disc space-y-1 pl-4 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-muted-foreground">{empty}</p>
  );

export const GovernedResearchPanel = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedEntity } = useIntelligenceOS();
  const activeQuestion = searchParams.get("question")?.trim() ?? "";

  const [question, setQuestion] = useState(activeQuestion);
  const [result, setResult] = useState<GovernedResearchResult | null>(null);
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  const [running, setRunning] = useState(false);
  const [priorTurn, setPriorTurn] = useState<PriorTurn | null>(null);
  const autoRanFor = useRef<string | null>(null);

  const runResearch = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || running) return;
    if (trimmed.length > 3600) {
      setNotice({ kind: "error", message: "Question exceeds the 3,600-character limit." });
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.set("question", trimmed);
    if (selectedEntity) next.set("entity", `${selectedEntity.type}:${selectedEntity.id}`);
    autoRanFor.current = trimmed;
    setSearchParams(next, { replace: true });

    setRunning(true);
    setNotice(null);
    setResult(null);

    const context = selectedEntity
      ? {
          type: selectedEntity.type,
          id: selectedEntity.id,
          name: selectedEntity.name,
          iso3:
            selectedEntity.type === "country" && /^[A-Z]{3}$/.test(String(selectedEntity.id))
              ? selectedEntity.id
              : null,
        }
      : undefined;

    const body: Record<string, unknown> = { question: trimmed };
    if (context) body.context = context;
    // Follow-up context is only sent when the backend has declared support.
    if (priorTurn?.followUpSupported) {
      body.follow_up = {
        previous_task_id: priorTurn.taskId,
        previous_question: priorTurn.question,
        previous_summary: priorTurn.summary,
      };
    }

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("orchestrate-multi-agent", { body });

      let response = asRecord(data);
      if (invokeError) {
        const ctx = (invokeError as { context?: Response }).context;
        if (ctx && typeof ctx.clone === "function") {
          response = asRecord(await ctx.clone().json().catch(() => ({})));
        }
        if (!Object.keys(response).length) throw invokeError;
      }

      if (response.status === "clarification_needed") {
        setNotice({
          kind: "clarification",
          message: str(response.clarification) ?? "Please name the geography to analyse.",
        });
        return;
      }
      if (response.code === "model_not_configured" || response.status === "not_ready") {
        setNotice({
          kind: "not_ready",
          message: str(response.error) ?? "The AICIS model is not configured.",
          missing: stringArray(asRecord(response.readiness).missing),
        });
        return;
      }
      if (response.reason === "mfa_required") {
        setNotice({
          kind: "mfa_required",
          message: "Verify two-step sign-in for this session to run research. Administrator access is checked separately.",
        });
        return;
      }
      if (response.status !== "completed") {
        const reason = str(response.degradation_reason) ?? str(response.error) ?? str(response.message) ?? "Research did not complete.";
        throw new Error(reason);
      }

      const parsed = parseResult(trimmed, response);
      setResult(parsed);
      setPriorTurn({
        taskId: parsed.taskId,
        question: trimmed,
        summary: parsed.executiveSummary,
        followUpSupported: asRecord(response.follow_up).supported === true,
      });
    } catch (researchError) {
      setNotice({
        kind: "error",
        message: researchError instanceof Error ? researchError.message : "Evidence research could not be completed.",
      });
    } finally {
      setRunning(false);
    }
  };

  // Auto-run a question carried from Ask AICIS exactly once.
  useEffect(() => {
    setQuestion(activeQuestion);
    if (activeQuestion && autoRanFor.current !== activeQuestion) {
      autoRanFor.current = activeQuestion;
      void runResearch(activeQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestion]);

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
          Independent specialist analysts reason only from stored evidence; disagreement is preserved, not averaged away.
        </p>
        {selectedEntity && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2.5 py-2 text-[10px]">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Context</span>
            <Badge variant="secondary" className="max-w-full truncate text-[10px]">
              {selectedEntity.type} · {selectedEntity.name}
            </Badge>
            <span className="text-muted-foreground">Used only when the question names no place.</span>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={priorTurn ? "Ask another question…" : "Ask an evidence-grounded intelligence question…"}
            maxLength={3600}
            disabled={running}
            aria-label="Evidence research question"
            className="flex-1"
          />
          <Button type="submit" disabled={running || !question.trim()} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {running ? "Researching…" : "Ask"}
          </Button>
        </form>

        {notice?.kind === "clarification" && (
          <div role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium"><MapPin className="h-3.5 w-3.5" />Which place?</div>
            <p className="mt-1 text-muted-foreground">{notice.message}</p>
          </div>
        )}

        {(notice?.kind === "error" || notice?.kind === "not_ready") && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">{notice.kind === "not_ready" ? "Research engine not ready" : "Research unavailable"}</div>
              <div className="mt-1 text-destructive/90">{notice.message}</div>
              {notice.kind === "not_ready" && notice.missing.length > 0 && (
                <div className="mt-1 font-mono text-[10px]">Missing: {notice.missing.join(", ")}</div>
              )}
              <div className="mt-1 text-[10px] text-muted-foreground">No fallback answer was generated in the interface.</div>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {result.scopeLabel && (
                <Badge variant="outline" className="gap-1 text-[10px]"><MapPin className="h-3 w-3" />{result.scopeLabel}</Badge>
              )}
              {result.domains.map((d) => (
                <Badge key={d} variant="secondary" className="text-[10px]">{d.replace("_", " ")}</Badge>
              ))}
              <Badge variant="outline" className="font-mono text-[10px]" title="Model and evidence-bounded confidence. Not a calibrated probability.">
                Evidence-bounded confidence {pct(result.confidence)} ({pct(result.confidenceLower)}–{pct(result.confidenceUpper)})
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Confidence reflects the models' judgement bounded by cited evidence. It is not a calibrated probability.
            </p>

            {result.degraded && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>Degraded answer: {result.degradationReason ?? "reason not reported"}</span>
              </div>
            )}

            <Section title="Executive summary">
              {result.executiveSummary ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.executiveSummary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No summary was returned.</p>
              )}
            </Section>

            <div className="grid gap-3 md:grid-cols-2">
              <Section title="Where specialists agree">
                <List items={result.agreedPoints} empty="No agreed points reported." />
              </Section>
              <Section title="Genuine disagreement">
                {result.disputedPoints.length ? (
                  <ul className="space-y-2 text-sm">
                    {result.disputedPoints.map((d, i) => (
                      <li key={i}>
                        <div className="font-medium">{d.topic}</div>
                        <div className="text-xs text-muted-foreground"><b>{d.specialistA}:</b> {d.positionA}</div>
                        <div className="text-xs text-muted-foreground"><b>{d.specialistB}:</b> {d.positionB}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No disputes reported.</p>
                )}
                {result.preservedDissent.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Preserved dissent</div>
                    <List items={result.preservedDissent} empty="" />
                  </div>
                )}
              </Section>
            </div>

            <Section title="What AICIS cannot conclude" tone="warn">
              <List items={result.missingEvidence} empty="No missing evidence was reported." />
            </Section>

            <div className="grid gap-3 md:grid-cols-3">
              <Section title="Strongest evidence">
                <p className="text-sm">{result.strongestEvidence ?? "Not reported."}</p>
              </Section>
              <Section title="Weakest assumption">
                <p className="text-sm">{result.weakestAssumption ?? "Not reported."}</p>
              </Section>
              <Section title="Next verification step">
                <p className="text-sm">{result.nextVerificationStep ?? "Not reported."}</p>
              </Section>
            </div>

            <Section title={`Citations (${result.citations.length})`}>
              {result.citations.length ? (
                <ul className="space-y-2">
                  {result.citations.map((c, i) => (
                    <li key={`${c.ref}-${i}`} className="text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[9px]">{c.ref}</Badge>
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                            {c.title}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="font-medium">{c.title}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {[c.publisher, c.observedAt ? new Date(c.observedAt).toLocaleDateString() : null, c.url ? null : "no document link stored"]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No citations were used.</p>
              )}
            </Section>

            <div className="text-[10px] text-muted-foreground">
              Response generated · <span className="font-mono">{result.generatedAt}</span>
              {(result.provider || result.model) && <> · Model · {[result.provider, result.model].filter(Boolean).join(" · ")}</>}
              {result.taskId && <> · Task <span className="font-mono">{result.taskId}</span></>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
