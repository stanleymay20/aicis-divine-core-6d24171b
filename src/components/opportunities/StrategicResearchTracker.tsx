import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";

type Workflow = {
  status?: "ready" | "requires_context" | "provider_required" | "manual_research" | "unsupported";
  kind?: string;
  label?: string;
  payload?: Record<string, unknown>;
  missing_context?: string[];
  provider_requirement?: string;
  notice?: string;
};

type ActionSnapshot = {
  id?: string;
  kind?: string;
  title?: string;
  trigger?: string;
  suggested_next_step?: string | null;
  workflow?: Workflow;
};

type ResearchRun = {
  id: string;
  strategic_audit_hash: string;
  action_id: string;
  action_kind: string;
  title: string;
  priority: "blocking" | "high" | "normal";
  lifecycle_status: "pending" | "in_progress" | "blocked" | "resolved" | "stale" | "cancelled";
  workflow_status?: string | null;
  source_candidate_id?: string | null;
  action_snapshot: ActionSnapshot;
  action_snapshot_hash: string;
  evidence_refs?: unknown[];
  updated_at?: string;
};

type ListResponse = {
  ok: boolean;
  runs?: ResearchRun[];
  error?: string;
  scope_notice?: string;
};

function shortHash(value: string) {
  return value ? value.slice(0, 12) + "…" : "—";
}

export function StrategicResearchTracker() {
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    setErrorMessage(null);
    const { data, error } = await supabase.functions.invoke("list-strategic-research-runs", {
      body: {
        statuses: ["pending", "in_progress", "blocked"],
        limit: 50,
      },
    });
    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const response = data as ListResponse;
    if (!response.ok) {
      setErrorMessage(response.error || "Research tracker is unavailable.");
      return;
    }

    setRuns(response.runs || []);
  };

  useEffect(() => {
    void load();

    const handler = () => {
      void load();
    };

    window.addEventListener("aicis:research-tracker-refresh", handler);
    return () => window.removeEventListener("aicis:research-tracker-refresh", handler);
  }, []);

  const setInProgress = async (run: ResearchRun) => {
    if (run.lifecycle_status === "in_progress") return run;

    const { data, error } = await supabase.functions.invoke("update-strategic-research-run", {
      body: {
        run_id: run.id,
        lifecycle_status: "in_progress",
      },
    });

    if (error) throw new Error(error.message);
    const updated = (data as { ok?: boolean; run?: ResearchRun })?.run;
    return updated || run;
  };

  const resume = async (run: ResearchRun) => {
    const workflow = run.action_snapshot?.workflow;
    if (!workflow || workflow.status !== "ready") {
      toast({
        title: "Workflow needs another step",
        description: workflow?.status === "provider_required"
          ? workflow.provider_requirement || "A provider integration is required."
          : workflow?.status === "requires_context"
            ? "Missing context: " + (workflow.missing_context || []).join(", ")
            : workflow?.notice || "This task currently requires manual research.",
        variant: "destructive",
      });
      return;
    }

    setResuming(run.id);
    let updated = run;
    try {
      updated = await setInProgress(run);
      setRuns((current) => current.map((item) => item.id === run.id ? updated : item));
    } catch (error) {
      toast({
        title: "Research status update failed",
        description: error instanceof Error ? error.message : "Could not mark the task in progress.",
        variant: "destructive",
      });
    } finally {
      setResuming(null);
    }

    const payload = workflow.payload || {};

    if (workflow.kind === "counterparty_discovery") {
      window.dispatchEvent(new CustomEvent("aicis:investigate-product", {
        detail: {
          product: payload.product_name,
          countries: Array.isArray(payload.countries) ? payload.countries : [],
          role: payload.role,
          origin_country: payload.origin_country,
          destination_country: payload.destination_country,
        },
      }));
      return;
    }

    if (workflow.kind === "landed_cost_verification") {
      document.getElementById("landed-cost-verification")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      toast({
        title: workflow.label || "Verify landed-cost evidence",
        description: "Use the current physical-trade candidate to complete attributable landed-cost coverage, then attach the evidence pack and rebuild.",
      });
      return;
    }

    if (workflow.kind === "actor_profile") {
      document.getElementById("strategic-capability-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (workflow.kind === "transaction_input_editor") {
      document.getElementById("transaction-input-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => (document.getElementById("transaction-input-editor") as HTMLTextAreaElement | null)?.focus(), 350);
      return;
    }

    if (workflow.kind === "reference_fx") {
      document.getElementById("transaction-path-lab")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast({
        title: "Open the current transaction bundle",
        description: "Use Add ECB reference FX in the Transaction Lab. Reference FX remains non-executable.",
      });
      return;
    }

    toast({
      title: workflow.label || "Research task opened",
      description: "This workflow is tracked, but no direct in-app handoff is configured yet.",
    });
  };

  return (
    <Card id="strategic-research-tracker">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Strategic Research Tracker
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Open blocker-driven evidence tasks persisted from audited strategic recommendations.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
            Research tracking is not available yet: {errorMessage}
          </div>
        ) : loading && runs.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading open research tasks…
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
            No pending, in-progress, or blocked strategic research tasks.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const workflow = run.action_snapshot?.workflow;
              return (
                <div key={run.id} className="rounded-md border border-border/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{run.title}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        audit {shortHash(run.strategic_audit_hash)} · action {shortHash(run.action_snapshot_hash)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={run.priority === "blocking" ? "destructive" : run.priority === "high" ? "secondary" : "outline"} className="text-[10px]">
                        {run.priority}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {run.lifecycle_status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>

                  {run.action_snapshot?.trigger ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">{run.action_snapshot.trigger}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {workflow?.status === "ready" ? null : <ShieldAlert className="h-3 w-3" />}
                      {workflow?.status
                        ? workflow.status.replace(/_/g, " ")
                        : "workflow metadata unavailable"}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={resuming === run.id || workflow?.status !== "ready"}
                      onClick={() => resume(run)}
                    >
                      {resuming === run.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      {workflow?.label || "Resume research"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
