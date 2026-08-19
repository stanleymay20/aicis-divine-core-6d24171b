import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Users, Scale, FileText } from "lucide-react";

const when = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const pct = (v: unknown) =>
  v === null || v === undefined ? "—" : `${Math.round(Number(v) * 100)}%`;

const tone = (ok: boolean) =>
  ok
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300";

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/30 p-6 text-sm flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground mt-1">{hint}</p>
      </div>
    </div>
  );
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : [];

export function MultiAgentSection() {
  const cases = useQuery({
    queryKey: ["pi-agent-cases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_case_quality" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const latestId = cases.data?.find((c) => c.status === "completed")?.task_id;

  const detail = useQuery({
    queryKey: ["pi-agent-detail", latestId],
    enabled: !!latestId,
    queryFn: async () => {
      const [analyses, synth, disagreements, citations] = await Promise.all([
        supabase.from("agent_specialist_analyses" as any).select("*").eq("task_id", latestId),
        supabase.from("agent_syntheses" as any).select("*").eq("task_id", latestId).maybeSingle(),
        supabase.from("agent_disagreements" as any).select("*").eq("task_id", latestId),
        supabase
          .from("agent_evidence_citations" as any)
          .select("specialist,source_kind,source_title,source_url,observed_at")
          .eq("task_id", latestId)
          .limit(60),
      ]);
      return {
        analyses: (analyses.data ?? []) as any[],
        synthesis: (synth.data ?? null) as any,
        disagreements: (disagreements.data ?? []) as any[],
        citations: (citations.data ?? []) as any[],
      };
    },
  });

  const task = cases.data?.find((c) => c.task_id === latestId);

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Multi-agent cases
          </CardTitle>
          <CardDescription>
            Each case fans one scoped question out to independent domain specialists. Cases where a
            specialist found no usable evidence are shown as degraded rather than hidden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cases.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : cases.data?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="text-right">Specialists</TableHead>
                    <TableHead className="text-right">Citations</TableHead>
                    <TableHead className="text-right">Disagreements</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.data.map((c) => (
                    <TableRow key={c.task_id} className={c.task_id === latestId ? "bg-primary/5" : ""}>
                      <TableCell className="text-xs max-w-md">{c.question}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.subject_key ?? "global"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {c.perspectives_ok}
                        {c.perspectives_failed ? ` (+${c.perspectives_failed} failed)` : ""}
                      </TableCell>
                      <TableCell className="text-right text-xs">{c.citations}</TableCell>
                      <TableCell className="text-right text-xs">{c.disagreements}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={tone(c.status === "completed" && c.citations_complete)}
                        >
                          {c.status === "completed" && !c.citations_complete
                            ? "completed (uncited)"
                            : c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {when(c.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty
              title="No multi-agent cases have been run."
              hint="Run the orchestrator against a country question so specialist perspectives and a synthesis are recorded."
            />
          )}
        </CardContent>
      </Card>

      {latestId && (
        <>
          <Card className="border-border bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Specialist perspectives
              </CardTitle>
              <CardDescription>{task?.question}</CardDescription>
            </CardHeader>
            <CardContent>
              {detail.isLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {detail.data?.analyses.map((a) => (
                    <div key={a.id} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold capitalize">{a.specialist}</span>
                        <div className="flex gap-2">
                          <Badge variant="outline">{pct(a.confidence)} confidence</Badge>
                          <Badge variant="outline" className={tone(a.evidence_count > 0)}>
                            {a.evidence_count} cited
                          </Badge>
                        </div>
                      </div>
                      {a.status !== "success" ? (
                        <p className="text-xs text-rose-300 mt-2">Run failed: {a.error}</p>
                      ) : (
                        <>
                          <p className="text-sm mt-2">{a.claim}</p>
                          <p className="text-xs text-muted-foreground mt-2 whitespace-pre-line">
                            {a.assessment}
                          </p>
                          {list(a.counterevidence).length > 0 && (
                            <div className="mt-2">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                Counterevidence
                              </div>
                              <ul className="text-xs list-disc pl-4 mt-1 space-y-0.5">
                                {list(a.counterevidence).map((c, i) => (
                                  <li key={i}>{c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {list(a.assumptions).length > 0 && (
                            <div className="mt-2">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                Assumptions
                              </div>
                              <ul className="text-xs list-disc pl-4 mt-1 space-y-0.5">
                                {list(a.assumptions).map((c, i) => (
                                  <li key={i}>{c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {a.uncertainty_notes && (
                            <p className="text-[11px] text-amber-300 mt-2">{a.uncertainty_notes}</p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" /> Synthesis with preserved dissent
              </CardTitle>
              <CardDescription>
                Disagreement is recorded, not averaged away. Acting on a synthesis requires human
                authorisation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.isLoading ? (
                <Skeleton className="h-44 w-full" />
              ) : detail.data?.synthesis ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      confidence {pct(detail.data.synthesis.confidence_lower)}–
                      {pct(detail.data.synthesis.confidence_upper)}
                    </Badge>
                    <Badge variant="outline" className={tone(!detail.data.synthesis.degraded)}>
                      {detail.data.synthesis.degraded ? "degraded" : "evidence complete"}
                    </Badge>
                    <Badge variant="outline">human authorisation required</Badge>
                  </div>
                  {detail.data.synthesis.degradation_reason && (
                    <p className="text-xs text-amber-300">
                      {detail.data.synthesis.degradation_reason}
                    </p>
                  )}
                  <p className="text-sm whitespace-pre-line">
                    {detail.data.synthesis.executive_summary}
                  </p>
                  <Block title="Agreed" items={list(detail.data.synthesis.agreed_points)} />
                  <Block
                    title="Preserved dissent"
                    items={list(detail.data.synthesis.preserved_dissent)}
                  />
                  <Block
                    title="Missing evidence"
                    items={list(detail.data.synthesis.missing_evidence)}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Strongest evidence" value={detail.data.synthesis.strongest_evidence} />
                    <Field label="Weakest assumption" value={detail.data.synthesis.weakest_assumption} />
                    <Field
                      label="Next verification step"
                      value={detail.data.synthesis.next_verification_step}
                    />
                  </div>
                  {detail.data.disagreements.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Recorded disagreements
                      </div>
                      {detail.data.disagreements.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-lg border border-border bg-background/40 p-3 text-xs space-y-1"
                        >
                          <div className="font-medium">{d.topic}</div>
                          <div>
                            <span className="capitalize text-primary">{d.specialist_a}</span>:{" "}
                            {d.position_a}
                          </div>
                          <div>
                            <span className="capitalize text-primary">{d.specialist_b}</span>:{" "}
                            {d.position_b}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  title="This case has no synthesis."
                  hint="A synthesis is only written when at least two specialist perspectives succeed."
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Evidence cited by the agents
              </CardTitle>
              <CardDescription>
                Every citation points at a real production row the specialist was shown.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.data?.citations.length ? (
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {detail.data.citations.map((c, i) => (
                    <div key={i} className="text-xs flex gap-2 items-baseline">
                      <Badge variant="outline" className="capitalize shrink-0">
                        {c.specialist}
                      </Badge>
                      <span className="text-muted-foreground shrink-0">{c.source_kind}</span>
                      <span className="truncate">{c.source_title}</span>
                      {c.source_url && (
                        <a
                          href={/^https?:\/\//.test(c.source_url) ? c.source_url : `https://${c.source_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary shrink-0 underline"
                        >
                          source
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No citations recorded for this case."
                  hint="The specialists reported that no usable evidence rows existed in the window."
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <ul className="text-xs list-disc pl-4 mt-1 space-y-0.5">
        {items.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <p className="text-xs mt-1">{value}</p>
    </div>
  );
}

export function ProspectiveSplitPanel() {
  const split = useQuery({
    queryKey: ["pi-ledger-split"],
    queryFn: async () => {
      const [rows, verified] = await Promise.all([
        supabase.from("prediction_ledger_validation_summary" as any).select("*"),
        supabase.from("prospective_skill_verified" as any).select("*").maybeSingle(),
      ]);
      if (rows.error) throw rows.error;
      return { rows: (rows.data ?? []) as any[], verified: (verified.data ?? null) as any };
    },
  });

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" /> Prospective vs retrospective
        </CardTitle>
        <CardDescription>
          Only predictions sealed before their outcome could be known count as forecasting skill.
          Retrospective backfills are labelled as history, never presented as foresight.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {split.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead>Validation mode</TableHead>
                    <TableHead className="text-right">Predictions</TableHead>
                    <TableHead className="text-right">Matured</TableHead>
                    <TableHead className="text-right">Scored</TableHead>
                    <TableHead className="text-right">Mean Brier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {split.data?.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={tone(r.prospective_status === "prospective_pre_outcome")}
                        >
                          {String(r.prospective_status).replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.validation_mode}</TableCell>
                      <TableCell className="text-right">{Number(r.predictions).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(r.matured).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(r.scored_outcomes).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{r.mean_brier ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Verified prospective skill:{" "}
              {Number(split.data?.verified?.prospective_scored ?? 0) === 0
                ? "NOT YET PROVEN — no prospective prediction has matured and been scored."
                : `${split.data?.verified?.prospective_scored} scored, mean Brier ${split.data?.verified?.prospective_mean_brier}.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
