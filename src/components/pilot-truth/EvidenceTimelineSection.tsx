import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  PlayCircle,
  ClipboardCheck,
  ShieldAlert,
  ShieldCheck,
  EyeOff,
  History,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";

type RiskAction = {
  id: string;
  country_iso3: string;
  domain: string;
  intervention_title: string;
  status: string;
  estimated_roi_eur: number | null;
  created_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  executed_at: string | null;
  executed_by: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  outcome_logged_at: string | null;
  outcome_logged_by: string | null;
  linked_outcome_id: string | null;
};

type EvidenceBadge = {
  outcome_id: string;
  evidence_quality_score: number | null;
  outcome_confidence: string | null;
  outcome_success: boolean | null;
  evidence_checklist: any;
  evidence_badge: string | null;
  excluded_from_learning: boolean | null;
};

type OutcomeRow = {
  id: string;
  outcome_success: boolean | null;
  outcome_confidence: string | null;
  evidence_url: string | null;
  evidence_source_type: string | null;
  evidence_note: string | null;
  evidence_quality_score: number | null;
  evidence_checklist: any;
  measured_outcome: string | null;
  measured_impact_score: number | null;
  net_value: number | null;
  roi_estimate: number | null;
  recorded_at: string | null;
  recorded_by: string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  user_id: string | null;
  severity: string | null;
  metadata: any;
};

type PilotRunRow = {
  pilot_run_id: string;
  action_id: string;
};

const fmtTs = (iso: string | null) =>
  iso ? format(new Date(iso), "yyyy-MM-dd HH:mm") : "—";

const shortId = (id: string | null) => (id ? id.slice(0, 8) : "—");

const fmtEur = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-EU", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(Number(n));

function badgeVisual(badge: string | null | undefined, excluded: boolean | null | undefined) {
  if (excluded) {
    return {
      label: "Excluded from Learning",
      icon: EyeOff,
      className: "bg-muted text-muted-foreground border-border",
    };
  }
  switch (badge) {
    case "strong":
      return {
        label: "Evidence Strong",
        icon: ShieldCheck,
        className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      };
    case "acceptable":
      return {
        label: "Evidence Acceptable",
        icon: ShieldCheck,
        className: "bg-blue-500/15 text-blue-300 border-blue-500/30",
      };
    case "weak":
      return {
        label: "Evidence Weak",
        icon: ShieldAlert,
        className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      };
    case "inconclusive":
      return {
        label: "Inconclusive",
        icon: ShieldAlert,
        className: "bg-muted text-muted-foreground border-border",
      };
    default:
      return null;
  }
}

const STATUS_OPTIONS = [
  "all",
  "proposed",
  "accepted",
  "executed",
  "outcome_logged",
  "dismissed",
  "expired",
];

const EVIDENCE_OPTIONS = ["all", "strong", "acceptable", "weak", "excluded", "none"];

export function EvidenceTimelineSection() {
  const [pilotRunFilter, setPilotRunFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [evidenceFilter, setEvidenceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [openAuditFor, setOpenAuditFor] = useState<RiskAction | null>(null);

  // --- Pilot runs (for filter dropdown + linkage) ---
  const pilotRunsQ = useQuery({
    queryKey: ["evidence-timeline-pilot-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_runs")
        .select("id, accepted_at, status, cohort_size")
        .order("accepted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pilotRunActionsQ = useQuery({
    queryKey: ["evidence-timeline-pilot-run-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_run_actions")
        .select("pilot_run_id, action_id");
      if (error) throw error;
      return (data ?? []) as PilotRunRow[];
    },
  });

  // --- Actions (timeline universe) ---
  const actionsQ = useQuery({
    queryKey: ["evidence-timeline-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("risk_action_recommendations")
        .select(
          "id, country_iso3, domain, intervention_title, status, estimated_roi_eur, created_at, accepted_at, accepted_by, executed_at, executed_by, dismissed_at, dismissed_by, outcome_logged_at, outcome_logged_by, linked_outcome_id"
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as RiskAction[];
    },
  });

  // --- Evidence badges ---
  const badgesQ = useQuery({
    queryKey: ["evidence-timeline-badges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pilot_outcome_evidence_badges" as any)
        .select(
          "outcome_id, evidence_quality_score, outcome_confidence, outcome_success, evidence_checklist, evidence_badge, excluded_from_learning"
        );
      if (error) throw error;
      return (data ?? []) as unknown as EvidenceBadge[];
    },
  });

  const badgesByOutcome = useMemo(() => {
    const map = new Map<string, EvidenceBadge>();
    (badgesQ.data ?? []).forEach((b) => map.set(b.outcome_id, b));
    return map;
  }, [badgesQ.data]);

  const pilotRunByAction = useMemo(() => {
    const map = new Map<string, string>();
    (pilotRunActionsQ.data ?? []).forEach((r) => map.set(r.action_id, r.pilot_run_id));
    return map;
  }, [pilotRunActionsQ.data]);

  const domains = useMemo(() => {
    const s = new Set<string>();
    (actionsQ.data ?? []).forEach((a) => a.domain && s.add(a.domain));
    return Array.from(s).sort();
  }, [actionsQ.data]);

  // --- Filter pipeline ---
  const filtered = useMemo(() => {
    const rows = actionsQ.data ?? [];
    return rows.filter((a) => {
      if (pilotRunFilter !== "all" && pilotRunByAction.get(a.id) !== pilotRunFilter) return false;
      if (countryFilter.trim() && !a.country_iso3?.toLowerCase().includes(countryFilter.trim().toLowerCase())) return false;
      if (domainFilter !== "all" && a.domain !== domainFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (evidenceFilter !== "all") {
        const b = a.linked_outcome_id ? badgesByOutcome.get(a.linked_outcome_id) : null;
        if (evidenceFilter === "none") {
          if (b) return false;
        } else if (evidenceFilter === "excluded") {
          if (!b?.excluded_from_learning) return false;
        } else {
          if (!b || b.excluded_from_learning) return false;
          if (b.evidence_badge !== evidenceFilter) return false;
        }
      }
      return true;
    });
  }, [
    actionsQ.data,
    pilotRunFilter,
    countryFilter,
    domainFilter,
    statusFilter,
    evidenceFilter,
    badgesByOutcome,
    pilotRunByAction,
  ]);

  // --- Audit log for the modal ---
  const auditQ = useQuery({
    queryKey: ["evidence-timeline-audit", openAuditFor?.id, openAuditFor?.linked_outcome_id],
    enabled: !!openAuditFor,
    queryFn: async () => {
      const action = openAuditFor!;
      const ids = [action.id, action.linked_outcome_id].filter(Boolean) as string[];
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, created_at, action, resource_type, resource_id, user_id, severity, metadata")
        .in("resource_id", ids)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const outcomeQ = useQuery({
    queryKey: ["evidence-timeline-outcome", openAuditFor?.linked_outcome_id],
    enabled: !!openAuditFor?.linked_outcome_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decision_outcome_log")
        .select(
          "id, outcome_success, outcome_confidence, evidence_url, evidence_source_type, evidence_note, evidence_quality_score, evidence_checklist, measured_outcome, measured_impact_score, net_value, roi_estimate, recorded_at, recorded_by"
        )
        .eq("id", openAuditFor!.linked_outcome_id!)
        .maybeSingle();
      if (error) throw error;
      return data as OutcomeRow | null;
    },
  });

  const handleExport = async (action: RiskAction) => {
    try {
      const ids = [action.id, action.linked_outcome_id].filter(Boolean) as string[];
      const [{ data: audit }, outcomeRes] = await Promise.all([
        supabase
          .from("audit_log")
          .select("*")
          .in("resource_id", ids)
          .order("created_at", { ascending: true }),
        action.linked_outcome_id
          ? supabase
              .from("decision_outcome_log")
              .select("*")
              .eq("id", action.linked_outcome_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const badge = action.linked_outcome_id
        ? badgesByOutcome.get(action.linked_outcome_id) ?? null
        : null;

      const payload = {
        exported_at: new Date().toISOString(),
        export_type: "single_action",
        action,
        pilot_run_id: pilotRunByAction.get(action.id) ?? null,
        evidence_badge: badge,
        outcome: (outcomeRes as any).data ?? null,
        audit_log: audit ?? [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidence-timeline-${action.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Exported evidence timeline");
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  const handleExportPilotRun = async (pilotRunId: string) => {
    if (!pilotRunId || pilotRunId === "all") {
      toast.error("Select a specific pilot run to export");
      return;
    }
    try {
      const actionIds = (pilotRunActionsQ.data ?? [])
        .filter((p) => p.pilot_run_id === pilotRunId)
        .map((p) => p.action_id);
      if (actionIds.length === 0) {
        toast.error("No actions linked to this pilot run");
        return;
      }
      const { data: actions } = await supabase
        .from("risk_action_recommendations")
        .select("*")
        .in("id", actionIds);

      const outcomeIds = (actions ?? [])
        .map((a: any) => a.linked_outcome_id)
        .filter(Boolean) as string[];

      const [{ data: outcomes }, { data: audit }, { data: pilotRun }] = await Promise.all([
        outcomeIds.length
          ? supabase.from("decision_outcome_log").select("*").in("id", outcomeIds)
          : Promise.resolve({ data: [] }),
        supabase
          .from("audit_log")
          .select("*")
          .in("resource_id", [...actionIds, ...outcomeIds])
          .order("created_at", { ascending: true }),
        supabase.from("pilot_runs").select("*").eq("id", pilotRunId).maybeSingle(),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        export_type: "pilot_run",
        pilot_run: pilotRun ?? null,
        actions: actions ?? [],
        outcomes: outcomes ?? [],
        evidence_badges: outcomeIds
          .map((oid) => badgesByOutcome.get(oid))
          .filter(Boolean),
        audit_log: audit ?? [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pilot-run-${pilotRunId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported pilot run (${actionIds.length} actions)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  const loading = actionsQ.isLoading || badgesQ.isLoading || pilotRunActionsQ.isLoading;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Evidence Timeline
            </CardTitle>
            <CardDescription>
              Read-only truth chain across every pilot action: lifecycle timestamps, actors,
              evidence quality, and audit log. Export real records as JSON.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pilotRunFilter === "all"}
            onClick={() => handleExportPilotRun(pilotRunFilter)}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export Pilot Run
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={pilotRunFilter} onValueChange={setPilotRunFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Pilot run" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All pilot runs</SelectItem>
              {(pilotRunsQ.data ?? []).map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  {shortId(r.id)} · {r.status} · n={r.cohort_size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Country (ISO3)"
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="h-9 text-xs uppercase"
          />

          <Select value={domainFilter} onValueChange={setDomainFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Domain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={evidenceFilter} onValueChange={setEvidenceFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Evidence" />
            </SelectTrigger>
            <SelectContent>
              {EVIDENCE_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o === "all" ? "All evidence" : o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o === "all" ? "All statuses" : o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : `${filtered.length} action${filtered.length === 1 ? "" : "s"} match filters`}
        </div>

        {/* Timeline list */}
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-6 text-center">
            No actions match the current filters.
          </div>
        ) : (
          <ScrollArea className="h-[520px] pr-2">
            <div className="space-y-2">
              {filtered.map((a) => {
                const badge = a.linked_outcome_id
                  ? badgesByOutcome.get(a.linked_outcome_id)
                  : null;
                const visual = badgeVisual(badge?.evidence_badge ?? null, badge?.excluded_from_learning ?? null);
                const pilotRunId = pilotRunByAction.get(a.id);
                return (
                  <div
                    key={a.id}
                    className="rounded-md border border-border bg-card/50 p-3 hover:bg-card/80 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {a.intervention_title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {a.country_iso3} · {a.domain} ·{" "}
                          <span className="font-mono">{shortId(a.id)}</span>
                          {pilotRunId && (
                            <>
                              {" "}
                              · pilot{" "}
                              <span className="font-mono">{shortId(pilotRunId)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {a.status}
                        </Badge>
                        {visual && (
                          <Badge variant="outline" className={`text-[10px] ${visual.className}`}>
                            <visual.icon className="h-3 w-3 mr-1" />
                            {visual.label}
                          </Badge>
                        )}
                        {badge?.evidence_quality_score != null && (
                          <span className="text-[10px] text-muted-foreground">
                            quality {Number(badge.evidence_quality_score).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Lifecycle row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-muted-foreground mb-2">
                      <LifecycleStep
                        icon={Clock}
                        label="Proposed"
                        ts={a.created_at}
                        actor={null}
                      />
                      <LifecycleStep
                        icon={CheckCircle2}
                        label={a.dismissed_at ? "Dismissed" : "Accepted"}
                        ts={a.dismissed_at ?? a.accepted_at}
                        actor={a.dismissed_by ?? a.accepted_by}
                      />
                      <LifecycleStep
                        icon={PlayCircle}
                        label="Executed"
                        ts={a.executed_at}
                        actor={a.executed_by}
                      />
                      <LifecycleStep
                        icon={ClipboardCheck}
                        label="Outcome"
                        ts={a.outcome_logged_at}
                        actor={a.outcome_logged_by}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="text-muted-foreground">
                        ROI est. {fmtEur(a.estimated_roi_eur)}
                        {a.linked_outcome_id && (
                          <>
                            {" · outcome "}
                            <span className="font-mono">{shortId(a.linked_outcome_id)}</span>
                          </>
                        )}
                        {badge?.excluded_from_learning ? (
                          <span className="ml-1 text-muted-foreground">· excluded from learning</span>
                        ) : badge ? (
                          <span className="ml-1 text-emerald-400">· included in learning</span>
                        ) : null}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setOpenAuditFor(a)}
                        >
                          <History className="h-3 w-3 mr-1" />
                          Audit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleExport(a)}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          JSON
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      {/* Audit modal */}
      <Dialog open={!!openAuditFor} onOpenChange={(o) => !o && setOpenAuditFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" /> Audit chain
            </DialogTitle>
            <DialogDescription className="text-xs">
              {openAuditFor?.intervention_title} ·{" "}
              <span className="font-mono">{shortId(openAuditFor?.id ?? null)}</span>
            </DialogDescription>
          </DialogHeader>

          {outcomeQ.data && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-medium text-foreground">Linked outcome</div>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                <div>Success: {String(outcomeQ.data.outcome_success ?? "—")}</div>
                <div>Confidence: {outcomeQ.data.outcome_confidence ?? "—"}</div>
                <div>Quality: {outcomeQ.data.evidence_quality_score ?? "—"}</div>
                <div>Net value: {fmtEur(outcomeQ.data.net_value)}</div>
                <div className="col-span-2 truncate">
                  Source: {outcomeQ.data.evidence_source_type ?? "—"}
                </div>
                {outcomeQ.data.evidence_url && (
                  <a
                    href={outcomeQ.data.evidence_url}
                    target="_blank"
                    rel="noreferrer"
                    className="col-span-2 text-primary inline-flex items-center gap-1 truncate"
                  >
                    <ExternalLink className="h-3 w-3" /> {outcomeQ.data.evidence_url}
                  </a>
                )}
              </div>
            </div>
          )}

          <ScrollArea className="h-[360px] pr-2">
            {auditQ.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (auditQ.data ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground p-4 text-center border border-dashed border-border rounded-md">
                No audit entries found for this action or its outcome yet.
              </div>
            ) : (
              <ol className="relative border-l border-border pl-4 space-y-3">
                {(auditQ.data ?? []).map((row) => (
                  <li key={row.id} className="text-xs">
                    <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary/60 border border-background" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{row.action}</span>
                      <span className="text-muted-foreground">{fmtTs(row.created_at)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {row.resource_type} · res{" "}
                      <span className="font-mono">{shortId(row.resource_id)}</span>
                      {row.user_id && (
                        <>
                          {" "}· actor <span className="font-mono">{shortId(row.user_id)}</span>
                        </>
                      )}
                      {row.severity && row.severity !== "info" && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          {row.severity}
                        </Badge>
                      )}
                    </div>
                    {row.metadata && Object.keys(row.metadata).length > 0 && (
                      <pre className="mt-1 p-2 rounded bg-muted/40 text-[10px] overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground">
                        {JSON.stringify(row.metadata, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>

          {openAuditFor && (
            <div className="flex justify-end pt-2">
              <Button size="sm" variant="outline" onClick={() => handleExport(openAuditFor)}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export JSON
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LifecycleStep({
  icon: Icon,
  label,
  ts,
  actor,
}: {
  icon: any;
  label: string;
  ts: string | null;
  actor: string | null;
}) {
  const done = !!ts;
  return (
    <div
      className={`flex items-start gap-1.5 ${
        done ? "text-foreground" : "text-muted-foreground/60"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${done ? "text-primary" : ""}`} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide">{label}</div>
        <div className="text-[11px] truncate">{ts ? fmtTs(ts) : "pending"}</div>
        {actor && (
          <div className="text-[10px] text-muted-foreground font-mono truncate">
            {shortId(actor)}
          </div>
        )}
      </div>
    </div>
  );
}
