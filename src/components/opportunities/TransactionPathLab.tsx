import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ExecutionPreviewPanel } from "@/components/opportunities/ExecutionPreviewPanel";
import { RfqDraftPanel } from "@/components/opportunities/RfqDraftPanel";
import { ArrowRight, CheckCircle2, CircleDollarSign, Compass, Loader2, MapPin, RefreshCw, Search, ShieldAlert, Users } from "lucide-react";

type RankItem = {
  candidate_id: string;
  title: string;
  transaction_type: string;
  score: number;
  execution_ready: boolean;
  product?: {
    id?: string;
    name?: string;
    unit?: string;
    specification?: string | null;
  } | null;
  quantity?: number | null;
  unit?: string | null;
  currency?: string | null;
  capital_required?: number | null;
  metrics: {
    base_profit: number;
    base_margin_pct: number;
    return_on_capital_pct: number;
    expected_value: number;
    profit_per_day: number;
  };
  execution_dossier: {
    missing_execution_fields: string[];
    where: {
      source?: {
        id?: string;
        role?: string;
        name?: string;
        country?: string;
        registration_id?: string | null;
        official_website?: string | null;
        product_id?: string | null;
        unit_price?: number;
        currency?: string;
        incoterm?: string | null;
        payment_terms?: string | null;
        compliance_status?: string | null;
        contact?: {
          company?: string;
          channel?: string;
          value?: string | null;
          source?: string | null;
        } | null;
        evidence_refs?: Array<Record<string, unknown>>;
      } | null;
      destination?: {
        id?: string;
        role?: string;
        name?: string;
        country?: string;
        registration_id?: string | null;
        official_website?: string | null;
        product_id?: string | null;
        unit_price?: number;
        currency?: string;
        incoterm?: string | null;
        payment_terms?: string | null;
        compliance_status?: string | null;
        contact?: {
          company?: string;
          channel?: string;
          value?: string | null;
          source?: string | null;
        } | null;
        evidence_refs?: Array<Record<string, unknown>>;
      } | null;
      route?: string[];
    };
    who: {
      contacts?: Array<{ company?: string; channel?: string; value?: string | null }>;
    };
    how?: { next_actions?: string[] };
    cost_breakdown?: Array<{ type?: string; amount?: number; currency?: string }>;
  };
};

type StrategicOption = {
  id: string;
  title: string;
  strategy_type: string;
  directness: string;
  currency: string | null;
  feasible: boolean;
  research_only: boolean;
  pareto_frontier: boolean;
  strategic_fit_score: number;
  capital_required: number | null;
  expected_value: number | null;
  downside_loss: number | null;
  reversibility_score: number;
  execution_friction_score: number;
  information_cost?: number | null;
  expected_decision_loss_reduction?: number | null;
  information_value_estimate?: number | null;
  commitment_cost?: number | null;
  option_value_estimate?: number | null;
  net_position_value_estimate?: number | null;
  sequence_steps: unknown[];
  assumptions: unknown[];
  sensitivity_cases: unknown[];
  feasibility_reasons: string[];
  missing_capabilities: string[];
  invalidation_rules: unknown[];
  switching_rules: unknown[];
  robustness: {
    scenario_count: number;
    worst_case: number | null;
    best_case: number | null;
    average_case: number | null;
    robustness_score: number | null;
  };
  sensitivity: {
    case_count: number;
    largest_absolute_delta: number | null;
    worst_delta: number | null;
    most_sensitive_assumption: string | null;
    cases: Array<{
      id: string;
      assumption: string;
      baseline_value: unknown;
      shocked_value: unknown;
      shocked_expected_value: number;
      delta_expected_value: number;
      evidence_status: "attributable" | "user_defined_scenario";
    }>;
  };
  regret: {
    comparable_scenarios: number;
    max_regret: number | null;
    average_regret: number | null;
  };
  doctrine_trace: Array<{
    id: string;
    source: string;
    principle: string;
  }>;
};

type StrategicResponse = {
  engine_version: string;
  option_count: number;
  feasible_count: number;
  pareto_frontier_count: number;
  primary_strategy: StrategicOption | null;
  primary_information_action?: StrategicOption | null;
  no_action_option: StrategicOption | null;
  options: StrategicOption[];
  comparison_currency?: string | null;
  comparison_blocked_reason?: string | null;
  audit?: {
    audit_version: string;
    algorithm: string;
    hash: string;
    canonical_length: number;
    semantics: string;
  };
  learning_packet?: {
    strategy_id: string;
    doctrine_ids: string[];
    comparator_strategy_id: string | null;
    pre_registered_outcome_metrics: string[];
    pre_commit_sequence_steps: unknown[];
    pre_commit_assumptions: unknown[];
    pre_commit_sensitivity_cases: unknown[];
    pre_commit_invalidation_rules: unknown[];
    pre_commit_switching_rules: unknown[];
    epistemic_boundary: string;
  } | null;
  scope_notice: string;
};

type ReferenceFxResponse = {
  ok: boolean;
  rates?: Array<Record<string, unknown>>;
  evidence_refs?: Array<Record<string, unknown>>;
  effective_date?: string;
  error?: string;
  message?: string;
};

type ResearchWorkflow = {
  workflow_version: string;
  status: "ready" | "requires_context" | "provider_required" | "manual_research" | "unsupported";
  kind: string;
  label: string;
  payload: Record<string, unknown>;
  read_only_or_research_only: true;
  external_execution_performed: false;
  missing_context?: string[];
  provider_requirement?: string;
  execution_boundary?: string;
  notice?: string;
  focus_fields?: string[];
};

type ResearchAction = {
  id: string;
  kind: string;
  title: string;
  priority: "blocking" | "high" | "normal";
  source_candidate_id: string | null;
  trigger: string;
  required_evidence: string[];
  completion_criteria: string[];
  suggested_next_step: string | null;
  research_only: true;
  transaction_eligible: false;
  expected_value: null;
  workflow?: ResearchWorkflow;
};

type ResearchPlan = {
  planner_version: string;
  action_count: number;
  blocking_count: number;
  high_count: number;
  actions: ResearchAction[];
  execution_performed: false;
  workflow_version?: string;
  workflow_status_counts?: Record<string, number>;
  workflow_scope_notice?: string;
  scope_notice: string;
};

type ResearchRun = {
  id: string;
  action_id: string;
  lifecycle_status: "pending" | "in_progress" | "blocked" | "resolved" | "stale" | "cancelled";
  action_snapshot_hash?: string;
  evidence_refs?: unknown[];
  resolution?: Record<string, unknown>;
  updated_at?: string;
};

type ResearchSyncResponse = {
  ok: boolean;
  runs?: ResearchRun[];
  error?: string;
};

type BuildResponse = {
  ok: boolean;
  build?: {
    candidates: unknown[];
    rejected_paths: unknown[];
    build_warnings: string[];
  };
  ranking?: {
    no_transaction_recommended: boolean;
    no_transaction_reason: string | null;
    top_ranked: RankItem | null;
    ranked: RankItem[];
    ranking_scope_notice: string;
  };
  strategic?: StrategicResponse;
  research_plan?: ResearchPlan;
  portfolio?: {
    allocation_available: boolean;
    reason?: string;
    currency?: string | null;
    capital_available?: number;
    reserve_capital?: number;
    capital_deployed?: number;
    expected_value?: number;
    base_case_profit?: number;
    selected_count?: number;
    selected?: Array<{
      candidate_id: string;
      title: string;
      capital_required: number;
      expected_value: number;
      base_profit: number;
      currency?: string | null;
    }>;
    optimality_proven?: boolean;
    optimization_method?: string;
    optimization_scope_notice?: string;
  };
  error?: string;
};

const SCHEMA_HINT = [
  "{",
  '  "as_of": "ISO timestamp",',
  '  "signal": {"id":"...","domain":"supply_chain","sectors":["..."]},',
  '  "product": {"id":"...","name":"...","unit":"tonne","sectors":["..."]},',
  '  "quantity": 10,',
  '  "comparison_currency": "EUR",',
  '  "fx_rates": [...verified or reference FX observations...],',
  '  "source_offers": [...verified supplier quotes...],',
  '  "sale_offers": [...verified buyer quotes...],',
  '  "routes": [...verified logistics quotes and costs...],',
  '  "structures": [...transaction structures...],',
  '  "scenario": {...validated downside/completion/cycle inputs...},',
  '  "strategic_context": {"actor_state": {...}, "terrain": {...}, "timing": {...}},',
  '  "indirect_strategies": [...evidence-backed alternatives...],',
  '  "position_options": [...optional strategic positions...],',
  '  "information_actions": [...decision-relevant information actions...]',
  '  "assumptions": [...explicit strategic assumptions...],',
  '  "sensitivity_cases": [...scoped shocked-value cases...]',
  "}"
].join("\n");

function extractFxRates(payload: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = payload.trim() ? JSON.parse(payload) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    const value = (parsed as Record<string, unknown>).fx_rates;
    return Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
        )
      : [];
  } catch {
    return [];
  }
}

export function TransactionPathLab() {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<BuildResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fxLoading, setFxLoading] = useState(false);
  const [researchRuns, setResearchRuns] = useState<Record<string, ResearchRun>>({});
  const [researchSyncing, setResearchSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ role?: "supplier" | "buyer"; offer?: Record<string, unknown> }>).detail || {};
      if (!detail.offer || (detail.role !== "supplier" && detail.role !== "buyer")) return;

      setPayload((current) => {
        let parsed: Record<string, unknown> = {};
        try {
          const value: unknown = current.trim() ? JSON.parse(current) : {};
          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>;
          }
        } catch {
          parsed = {};
        }

        const key = detail.role === "supplier" ? "source_offers" : "sale_offers";
        const existing = Array.isArray(parsed[key]) ? parsed[key] : [];
        const offerId = typeof detail.offer?.id === "string" ? detail.offer.id : null;
        const withoutDuplicate = offerId
          ? existing.filter((item) => {
              if (typeof item !== "object" || item === null || Array.isArray(item)) return true;
              return (item as Record<string, unknown>).id !== offerId;
            })
          : existing;

        return JSON.stringify({
          ...parsed,
          [key]: [...withoutDuplicate, detail.offer],
        }, null, 2);
      });

      const evidenceRefs = Array.isArray(detail.offer.evidence_refs) ? detail.offer.evidence_refs : [];
      if (evidenceRefs.length) {
        window.dispatchEvent(new CustomEvent("aicis:research-evidence-satisfied", {
          detail: {
            completion_kind: detail.role === "supplier" ? "supplier_quote_verified" : "buyer_quote_verified",
            evidence_refs: evidenceRefs,
            metadata: { offer_id: detail.offer.id ?? null },
          },
        }));
      }

      window.requestAnimationFrame(() => {
        document.getElementById("transaction-path-lab")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    const routeHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ route?: Record<string, unknown> }>).detail || {};
      if (!detail.route) return;

      setPayload((current) => {
        let parsed: Record<string, unknown> = {};
        try {
          const value: unknown = current.trim() ? JSON.parse(current) : {};
          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>;
          }
        } catch {
          parsed = {};
        }

        const existing = Array.isArray(parsed.routes) ? parsed.routes : [];
        const routeId = typeof detail.route?.id === "string" ? detail.route.id : null;
        const withoutDuplicate = routeId
          ? existing.filter((item) => {
              if (typeof item !== "object" || item === null || Array.isArray(item)) return true;
              return (item as Record<string, unknown>).id !== routeId;
            })
          : existing;

        return JSON.stringify({
          ...parsed,
          routes: [...withoutDuplicate, detail.route],
        }, null, 2);
      });

      const evidenceRefs = Array.isArray(detail.route.evidence_refs) ? detail.route.evidence_refs : [];
      if (evidenceRefs.length) {
        window.dispatchEvent(new CustomEvent("aicis:research-evidence-satisfied", {
          detail: {
            completion_kind: "logistics_route_verified",
            evidence_refs: evidenceRefs,
            metadata: { route_id: detail.route.id ?? null },
          },
        }));
      }

      window.requestAnimationFrame(() => {
        document.getElementById("transaction-path-lab")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    window.addEventListener("aicis:add-verified-offer", handler as EventListener);
    window.addEventListener("aicis:add-verified-route", routeHandler as EventListener);
    return () => {
      window.removeEventListener("aicis:add-verified-offer", handler as EventListener);
      window.removeEventListener("aicis:add-verified-route", routeHandler as EventListener);
    };
  }, []);

  const addReferenceFx = async () => {
    let current: Record<string, unknown>;
    try {
      const parsed: unknown = payload.trim() ? JSON.parse(payload) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Transaction bundle must be a JSON object");
      }
      current = parsed as Record<string, unknown>;
    } catch (error) {
      toast({
        title: "Invalid JSON",
        description: error instanceof Error ? error.message : "Transaction bundle must be valid JSON.",
        variant: "destructive",
      });
      return;
    }

    setFxLoading(true);
    const { data, error } = await supabase.functions.invoke("fetch-reference-fx", { body: {} });
    setFxLoading(false);
    if (error) {
      toast({ title: "Reference FX fetch failed", description: error.message, variant: "destructive" });
      return;
    }

    const response = data as ReferenceFxResponse;
    if (!response.ok || !response.rates?.length) {
      toast({
        title: "Reference FX unavailable",
        description: response.message || response.error || "No ECB reference rates were returned.",
        variant: "destructive",
      });
      return;
    }

    const existingRates = Array.isArray(current.fx_rates) ? current.fx_rates : [];
    const next = {
      ...current,
      fx_rates: [...existingRates, ...response.rates],
    };
    setPayload(JSON.stringify(next, null, 2));
    if (response.evidence_refs?.length) {
      window.dispatchEvent(new CustomEvent("aicis:research-evidence-satisfied", {
        detail: {
          completion_kind: "reference_fx_attached",
          evidence_refs: response.evidence_refs,
          metadata: {
            effective_date: response.effective_date ?? null,
            rate_count: response.rates.length,
          },
        },
      }));
    }
    toast({
      title: "ECB reference FX added",
      description: `${response.rates.length} reference rates added for research comparison only. Executable FX is still required before transaction approval.`,
    });
  };

  const addExecutableFx = (rate: Record<string, unknown>, candidateId: string) => {
    let current: Record<string, unknown>;
    try {
      const parsed: unknown = payload.trim() ? JSON.parse(payload) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Transaction bundle must be a JSON object");
      }
      current = parsed as Record<string, unknown>;
    } catch (error) {
      toast({
        title: "Executable FX could not be added",
        description: error instanceof Error ? error.message : "The transaction bundle is not valid JSON.",
        variant: "destructive",
      });
      return;
    }

    const existingRates = Array.isArray(current.fx_rates) ? current.fx_rates : [];
    const rateId = typeof rate.id === "string" ? rate.id : null;
    const withoutDuplicate = rateId
      ? existingRates.filter((item) => {
          if (typeof item !== "object" || item === null || Array.isArray(item)) return true;
          return (item as Record<string, unknown>).id !== rateId;
        })
      : existingRates;

    setPayload(JSON.stringify({
      ...current,
      fx_rates: [...withoutDuplicate, rate],
    }, null, 2));

    const evidenceRefs = Array.isArray(rate.evidence_refs) ? rate.evidence_refs : [];
    if (evidenceRefs.length) {
      window.dispatchEvent(new CustomEvent("aicis:research-evidence-satisfied", {
        detail: {
          completion_kind: "executable_fx_verified",
          source_candidate_id: candidateId,
          evidence_refs: evidenceRefs,
          metadata: {
            fx_rate_id: rate.id ?? null,
            provider: rate.provider ?? null,
            provider_quote_id: rate.provider_quote_id ?? null,
          },
        },
      }));
    }

    setResult(null);
    setResearchRuns({});
    toast({
      title: "Executable FX evidence added",
      description: "The previous ranking is now stale. Rebuild transaction paths before any human review or approval.",
    });
    window.requestAnimationFrame(() => {
      document.getElementById("transaction-input-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const syncResearchRuns = async () => {
    const auditHash = result?.strategic?.audit?.hash;
    const plan = result?.research_plan;
    if (!auditHash || !plan) {
      toast({
        title: "Research tracking unavailable",
        description: "Build a strategic result with an audit hash before saving the research plan.",
        variant: "destructive",
      });
      return researchRuns;
    }

    setResearchSyncing(true);
    const { data, error } = await supabase.functions.invoke("sync-strategic-research-runs", {
      body: {
        strategic_audit_hash: auditHash,
        research_plan: plan,
      },
    });
    setResearchSyncing(false);

    if (error) {
      toast({
        title: "Research tracking unavailable",
        description: error.message + " The research handoff can still proceed, but this task will not be persisted.",
        variant: "destructive",
      });
      return researchRuns;
    }

    const response = data as ResearchSyncResponse;
    if (!response.ok) {
      toast({
        title: "Research tracking unavailable",
        description: response.error || "The research plan could not be synchronized.",
        variant: "destructive",
      });
      return researchRuns;
    }

    const next = Object.fromEntries((response.runs || []).map((run) => [run.action_id, run]));
    setResearchRuns(next);
    return next;
  };

  const ensureResearchRunStarted = async (action: ResearchAction) => {
    const runs = researchRuns[action.id] ? researchRuns : await syncResearchRuns();
    const run = runs[action.id];
    if (!run) return true;

    if (["resolved", "stale", "cancelled"].includes(run.lifecycle_status)) {
      toast({
        title: "Research task is closed",
        description: "Rebuild the strategic plan to generate a new audited task instead of reopening a terminal record.",
        variant: "destructive",
      });
      return false;
    }

    if (run.lifecycle_status === "in_progress") return true;

    const { data, error } = await supabase.functions.invoke("update-strategic-research-run", {
      body: {
        run_id: run.id,
        lifecycle_status: "in_progress",
      },
    });

    if (error) {
      toast({
        title: "Could not update research status",
        description: error.message + " The research handoff will still open.",
        variant: "destructive",
      });
      return true;
    }

    const updated = (data as { ok?: boolean; run?: ResearchRun })?.run;
    if (updated) {
      setResearchRuns((current) => ({ ...current, [action.id]: updated }));
    }
    return true;
  };

  const startResearchWorkflow = async (action: ResearchAction) => {
    const workflow = action.workflow;
    if (!workflow || workflow.status !== "ready") return;

    const canStart = await ensureResearchRunStarted(action);
    if (!canStart) return;

    if (workflow.kind === "counterparty_discovery") {
      const role = workflow.payload.role;
      window.dispatchEvent(new CustomEvent("aicis:investigate-product", {
        detail: {
          product: workflow.payload.product_name,
          countries: Array.isArray(workflow.payload.countries) ? workflow.payload.countries : [],
          role,
          origin_country: workflow.payload.origin_country,
          destination_country: workflow.payload.destination_country,
        },
      }));
      toast({
        title: workflow.label,
        description: "Research handoff opened. Discovery results remain unverified until the verification gates are completed.",
      });
      return;
    }

    if (workflow.kind === "reference_fx") {
      await addReferenceFx();
      return;
    }

    if (workflow.kind === "actor_profile") {
      document.getElementById("strategic-capability-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast({
        title: "Review strategic capability profile",
        description: "Only add a capability when it is genuinely available; AICIS will not infer it from the opportunity.",
      });
      return;
    }

    if (workflow.kind === "transaction_input_editor") {
      const editor = document.getElementById("transaction-input-editor") as HTMLTextAreaElement | null;
      editor?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => editor?.focus(), 350);
      toast({
        title: workflow.label,
        description: workflow.focus_fields?.length
          ? "Update and evidence: " + workflow.focus_fields.join(", ") + "."
          : "Update the transaction bundle with attributable evidence, then rebuild.",
      });
      return;
    }
  };

  const strategicAuditHash = result?.strategic?.audit?.hash ?? null;

  useEffect(() => {
    if (!strategicAuditHash) return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        completion_kind?: string;
        evidence_refs?: unknown[];
        source_candidate_id?: string | null;
        metadata?: Record<string, unknown>;
      }>).detail || {};

      if (!detail.completion_kind || !Array.isArray(detail.evidence_refs) || detail.evidence_refs.length === 0) return;

      void (async () => {
        const { data, error } = await supabase.functions.invoke("complete-strategic-research-actions", {
          body: {
            strategic_audit_hash: strategicAuditHash,
            completion_kind: detail.completion_kind,
            source_candidate_id: detail.source_candidate_id ?? null,
            evidence_refs: detail.evidence_refs,
            metadata: detail.metadata || {},
          },
        });

        if (error) {
          toast({
            title: "Research evidence added, tracker update failed",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        const response = data as { ok?: boolean; resolved_run_count?: number; runs?: ResearchRun[]; error?: string };
        if (!response.ok) {
          toast({
            title: "Research evidence added, tracker update failed",
            description: response.error || "The matching research task could not be resolved.",
            variant: "destructive",
          });
          return;
        }

        if (response.runs?.length) {
          setResearchRuns((current) => {
            const next = { ...current };
            for (const run of response.runs || []) next[run.action_id] = run;
            return next;
          });
        }

        if ((response.resolved_run_count || 0) > 0) {
          window.dispatchEvent(new CustomEvent("aicis:research-tracker-refresh"));
          toast({
            title: "Research blocker resolved",
            description: `${response.resolved_run_count} audited research task${response.resolved_run_count === 1 ? "" : "s"} resolved with attributable evidence.`,
          });
        }
      })();
    };

    window.addEventListener("aicis:research-evidence-satisfied", handler as EventListener);
    return () => window.removeEventListener("aicis:research-evidence-satisfied", handler as EventListener);
  }, [strategicAuditHash, toast]);

  const build = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      toast({
        title: "Invalid JSON",
        description: "Paste a valid verified offer bundle before building transaction paths.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("build-transaction-paths", {
      body: { input: parsed },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Transaction build failed", description: error.message, variant: "destructive" });
      return;
    }

    const response = data as BuildResponse;
    setResult(response);
    setResearchRuns({});
    if (!response.ok) {
      toast({
        title: "Transaction build failed",
        description: response.error || "The verified offer bundle could not be evaluated.",
        variant: "destructive",
      });
    }
  };

  const top = result?.ranking?.top_ranked ?? null;

  return (
    <Card id="transaction-path-lab">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          Verified Transaction Lab
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Build and compare transaction paths from real supplier, buyer, logistics and scenario inputs.
          AICIS will not invent missing prices, FX rates, quotes, contacts or profitability.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-2">
            <Textarea
              id="transaction-input-editor"
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              placeholder={SCHEMA_HINT}
              className="min-h-[300px] font-mono text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Evidence refs require a source id, observation time and either a citation id or SHA-256 digest.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={addReferenceFx} disabled={fxLoading} className="gap-2">
                  {fxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Add ECB reference FX
                </Button>
                <Button onClick={build} disabled={loading || !payload.trim()} className="gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Build & rank paths
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-4">
            {!result ? (
              <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <CircleDollarSign className="h-8 w-8 mb-3 opacity-50" />
                <p className="text-sm font-medium text-foreground">No verified bundle evaluated yet</p>
                <p className="text-xs mt-1 max-w-sm">
                  Results will show the top supplied path for your saved relevance, capital, risk and objective settings.
                </p>
              </div>
            ) : result.ranking?.no_transaction_recommended ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  No transaction recommended
                </div>
                <p className="text-xs text-muted-foreground">
                  {result.ranking.no_transaction_reason || "No supplied path cleared the configured thresholds."}
                </p>
                <BuildStats result={result} />
              </div>
            ) : top ? (
              <TopPath candidate={top} result={result} />
            ) : (
              <div className="text-sm text-muted-foreground">
                The bundle was processed, but no ranked path was returned.
              </div>
            )}
          </div>
        </div>

        {result?.build?.build_warnings?.length ? (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium">Build warnings</p>
            <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
              {result.build.build_warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          </div>
        ) : null}

        {result?.ranking?.ranking_scope_notice ? (
          <p className="text-[10px] text-muted-foreground">{result.ranking.ranking_scope_notice}</p>
        ) : null}

        {result?.strategic ? <StrategicRecommendation strategic={result.strategic} /> : null}

        {top && result?.strategic?.audit?.hash ? (
          <>
            <RfqDraftPanel
              key={top.candidate_id + ":" + result.strategic.audit.hash}
              candidate={{
                candidate_id: top.candidate_id,
                title: top.title,
                product: top.product ?? null,
                quantity: top.quantity ?? null,
                unit: top.unit ?? null,
                currency: top.currency ?? null,
                execution_dossier: {
                  where: {
                    source: top.execution_dossier.where.source ?? null,
                    destination: top.execution_dossier.where.destination ?? null,
                  },
                },
              }}
              strategicAuditHash={result.strategic.audit.hash}
              comparisonCurrency={top.currency ?? null}
              fxRates={extractFxRates(payload)}
            />

            <ExecutionPreviewPanel
              candidate={{
                candidate_id: top.candidate_id,
                title: top.title,
                transaction_type: top.transaction_type,
                execution_ready: top.execution_ready,
                currency: top.currency ?? null,
                capital_required: top.capital_required ?? null,
              }}
              strategicAuditHash={result.strategic.audit.hash}
              onAddExecutableFx={addExecutableFx}
            />
          </>
        ) : null}

        {result?.research_plan ? (
          <ResearchPlanPanel
            plan={result.research_plan}
            runs={researchRuns}
            syncing={researchSyncing}
            onSyncPlan={syncResearchRuns}
            onStartWorkflow={startResearchWorkflow}
          />
        ) : null}

        {result?.portfolio ? <PortfolioAllocation portfolio={result.portfolio} /> : null}
      </CardContent>
    </Card>
  );
}

function TopPath({ candidate, result }: { candidate: RankItem; result: BuildResponse }) {
  const source = candidate.execution_dossier?.where?.source;
  const destination = candidate.execution_dossier?.where?.destination;
  const route = candidate.execution_dossier?.where?.route || [];
  const contacts = candidate.execution_dossier?.who?.contacts || [];
  const actions = candidate.execution_dossier?.how?.next_actions || [];
  const costs = candidate.execution_dossier?.cost_breakdown || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Top supplied path</p>
          <h3 className="text-sm font-semibold mt-0.5">{candidate.title}</h3>
        </div>
        <div className="flex gap-1.5">
          <Badge variant="outline">score {candidate.score.toFixed(1)}</Badge>
          <Badge variant={candidate.execution_ready ? "default" : "secondary"}>
            {candidate.execution_ready ? "execution-ready inputs" : "research-only"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Base profit" value={formatMoney(candidate.metrics.base_profit, source?.currency)} />
        <Metric label="Expected value" value={formatMoney(candidate.metrics.expected_value, source?.currency)} />
        <Metric label="Base margin" value={candidate.metrics.base_margin_pct.toFixed(2) + "%"} />
        <Metric label="Return on capital" value={candidate.metrics.return_on_capital_pct.toFixed(2) + "%"} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          Where
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{source?.name || "Source unknown"}</span>
          {source?.country ? " · " + source.country : ""}
          <span className="mx-2">→</span>
          <span className="text-foreground font-medium">{destination?.name || "Buyer unknown"}</span>
          {destination?.country ? " · " + destination.country : ""}
        </div>
        {route.length ? <p className="text-[11px] text-muted-foreground">{route.join(" → ")}</p> : null}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Users className="h-3.5 w-3.5 text-primary" />
          Who & contact
        </div>
        {contacts.length ? (
          <div className="space-y-1">
            {contacts.map((contact, index) => (
              <div key={(contact.company || "contact") + "-" + index} className="text-[11px] text-muted-foreground">
                <span className="text-foreground">{contact.company}</span> · {contact.channel}
                {contact.value ? " · " + contact.value : ""}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">No verified business contact channels supplied.</p>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold">Cost chain</p>
        <div className="space-y-1">
          {costs.map((cost, index) => (
            <div key={(cost.type || "cost") + "-" + index} className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{cost.type || "cost"}</span>
              <span>{formatMoney(cost.amount, cost.currency || source?.currency)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold">Next actions</p>
        <ol className="space-y-1 text-[11px] text-muted-foreground">
          {actions.slice(0, 5).map((action, index) => <li key={action}>{index + 1}. {action}</li>)}
        </ol>
      </section>

      {!candidate.execution_ready && candidate.execution_dossier?.missing_execution_fields?.length ? (
        <div className="rounded-md bg-muted/30 p-2.5">
          <p className="text-[11px] font-medium">Missing before execution</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {candidate.execution_dossier.missing_execution_fields.join(", ")}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          Input dossier is complete enough for human review; no external execution has occurred.
        </div>
      )}

      <BuildStats result={result} />
    </div>
  );
}

function ResearchPlanPanel({
  plan,
  runs,
  syncing,
  onSyncPlan,
  onStartWorkflow,
}: {
  plan: ResearchPlan;
  runs: Record<string, ResearchRun>;
  syncing: boolean;
  onSyncPlan: () => void | Promise<Record<string, ResearchRun>>;
  onStartWorkflow: (action: ResearchAction) => void | Promise<void>;
}) {
  if (!plan.actions.length) {
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Evidence acquisition plan</p>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          No additional blocker-driven research tasks were generated from the supplied build, ranking, and strategy results.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Evidence acquisition plan</p>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Concrete research tasks generated from unresolved dependencies. None of these tasks is an execution recommendation or profit claim.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.blocking_count ? <Badge variant="destructive">{plan.blocking_count} blocking</Badge> : null}
          {plan.high_count ? <Badge variant="secondary">{plan.high_count} high</Badge> : null}
          <Badge variant="outline">{plan.action_count} total</Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={syncing}
            onClick={() => onSyncPlan()}
          >
            {syncing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Save & track
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {plan.actions.map((item, index) => (
          <div key={item.id} className="rounded-md border border-border/70 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{index + 1}. {item.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{item.trigger}</p>
              </div>
              <Badge
                variant={item.priority === "blocking" ? "destructive" : item.priority === "high" ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {item.priority}
              </Badge>
              {runs[item.id] ? (
                <Badge variant="outline" className="text-[10px]">
                  {runs[item.id].lifecycle_status.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>

            {item.required_evidence.length ? (
              <div className="mt-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evidence needed</p>
                <p className="mt-0.5 text-[11px]">{item.required_evidence.join(" · ")}</p>
              </div>
            ) : null}

            {item.completion_criteria.length ? (
              <div className="mt-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Complete when</p>
                <ul className="mt-0.5 space-y-0.5 text-[11px]">
                  {item.completion_criteria.map((criterion) => <li key={criterion}>• {criterion}</li>)}
                </ul>
              </div>
            ) : null}

            {item.suggested_next_step ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Next: {item.suggested_next_step}
              </p>
            ) : null}

            {item.workflow ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                <div className="min-w-0">
                  <Badge
                    variant={item.workflow.status === "ready" ? "outline" : "secondary"}
                    className="text-[10px]"
                  >
                    {item.workflow.status.replace(/_/g, " ")}
                  </Badge>
                  {item.workflow.status !== "ready" ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {item.workflow.status === "provider_required"
                        ? item.workflow.provider_requirement || "A provider integration is required."
                        : item.workflow.status === "requires_context"
                          ? "Missing context: " + (item.workflow.missing_context || []).join(", ")
                          : item.workflow.notice || "This task currently requires manual research."}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {item.workflow.execution_boundary || "Research-only handoff."}
                    </p>
                  )}
                </div>
                {item.workflow.status === "ready" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onStartWorkflow(item)}
                  >
                    {item.workflow.label}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {plan.workflow_scope_notice ? (
        <p className="text-[10px] text-muted-foreground">{plan.workflow_scope_notice}</p>
      ) : null}
      <p className="text-[10px] text-muted-foreground">{plan.scope_notice}</p>
    </div>
  );
}

function StrategicRecommendation({ strategic }: { strategic: StrategicResponse }) {
  const primary = strategic.primary_strategy;
  const frontier = strategic.options.filter((option) => option.pareto_frontier);

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Strategic Doctrine Engine</p>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Compares feasible strategies, not just transactions. Sunzi-derived principles are treated as testable heuristics.
          </p>
        </div>
        <Badge variant="outline">{strategic.pareto_frontier_count} frontier options</Badge>
      </div>

      {primary ? (
        <div className="rounded-md bg-muted/20 p-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Primary strategy</p>
              <p className="text-sm font-semibold">{primary.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {primary.strategy_type.replace(/_/g, " ")} · {primary.directness}
              </p>
            </div>
            <Badge>{primary.strategic_fit_score.toFixed(1)} fit</Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {primary.strategy_type === "information_gathering" ? (
              <>
                <Metric label="Information value" value={formatMoney(primary.information_value_estimate, primary.currency)} />
                <Metric label="Information cost" value={formatMoney(primary.information_cost, primary.currency)} />
                <Metric label="Loss reduction" value={formatMoney(primary.expected_decision_loss_reduction, primary.currency)} />
                <Metric label="Reversibility" value={primary.reversibility_score.toFixed(0) + "/100"} />
              </>
            ) : primary.strategy_type === "position_building" ? (
              <>
                <Metric label="Net position value" value={formatMoney(primary.net_position_value_estimate, primary.currency)} />
                <Metric label="Option value" value={formatMoney(primary.option_value_estimate, primary.currency)} />
                <Metric label="Commitment cost" value={formatMoney(primary.commitment_cost, primary.currency)} />
                <Metric label="Reversibility" value={primary.reversibility_score.toFixed(0) + "/100"} />
              </>
            ) : (
              <>
                <Metric label="Expected value" value={formatMoney(primary.expected_value, primary.currency)} />
                <Metric label="Capital required" value={formatMoney(primary.capital_required, primary.currency)} />
                <Metric label="Downside" value={formatMoney(primary.downside_loss, primary.currency)} />
                <Metric label="Reversibility" value={primary.reversibility_score.toFixed(0) + "/100"} />
              </>
            )}
          </div>

          {primary.strategy_type === "information_gathering" ? (
            <div className="rounded-md border border-border/70 bg-background/60 p-2.5 text-[11px] text-muted-foreground">
              AICIS is recommending information acquisition before commitment because the supplied, evidenced reduction in expected decision loss exceeds the information cost. This is not a guarantee that the inspection or research will produce that saving.
            </div>
          ) : null}

          {primary.strategy_type === "position_building" ? (
            <div className="rounded-md border border-border/70 bg-background/60 p-2.5 text-[11px] text-muted-foreground">
              AICIS is valuing an evidence-backed strategic position before full execution. The option value is supplied decision support, not a guaranteed future payoff.
            </div>
          ) : null}

          {primary.sequence_steps.length ? (
            <div className="rounded-md border border-border/70 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sequence of moves</p>
              <ol className="mt-1 space-y-1 text-[11px]">
                {primary.sequence_steps.map((step, index) => (
                  <li key={"sequence-" + index}>{index + 1}. {String(step)}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {primary.sensitivity.case_count ? (
            <div className="rounded-md border border-border/70 p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Strategy sensitivity</p>
                <Badge variant="outline" className="text-[10px]">
                  most sensitive: {primary.sensitivity.most_sensitive_assumption || "unknown"}
                </Badge>
              </div>
              <div className="space-y-1">
                {primary.sensitivity.cases.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 text-[11px]">
                    <div className="min-w-0">
                      <p className="text-foreground">{item.assumption}</p>
                      <p className="text-[10px] text-muted-foreground">
                        baseline {String(item.baseline_value ?? "—")} → shocked {String(item.shocked_value ?? "—")}
                        {" · "}{item.evidence_status === "attributable" ? "attributable" : "user-defined what-if"}
                      </p>
                    </div>
                    <span className={item.delta_expected_value < 0 ? "text-destructive" : ""}>
                      {item.delta_expected_value >= 0 ? "+" : ""}
                      {formatMoney(item.delta_expected_value, primary.currency)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                These are supplied sensitivity cases, not probabilities or automatically generated forecasts.
              </p>
            </div>
          ) : null}

          {primary.robustness.scenario_count ? (
            <div className="rounded-md border border-border/70 p-2.5 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Scenario robustness</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric label="Worst case" value={formatMoney(primary.robustness.worst_case, primary.currency)} />
                <Metric label="Average case" value={formatMoney(primary.robustness.average_case, primary.currency)} />
                <Metric label="Best case" value={formatMoney(primary.robustness.best_case, primary.currency)} />
                <Metric
                  label="Robustness"
                  value={primary.robustness.robustness_score == null ? "—" : primary.robustness.robustness_score.toFixed(1) + "/100"}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Robustness uses only the supplied scenario outcomes and does not imply those scenarios are exhaustive.
              </p>
            </div>
          ) : null}

          <div className="rounded-md border border-border/70 p-2.5 text-[11px]">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Comparative regret</p>
            {primary.regret.comparable_scenarios ? (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Metric label="Maximum regret" value={formatMoney(primary.regret.max_regret, primary.currency)} />
                <Metric label="Average regret" value={formatMoney(primary.regret.average_regret, primary.currency)} />
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Regret is unavailable until at least two strategies have outcomes for the same supplied scenarios.
              </p>
            )}
          </div>

          {primary.doctrine_trace.length ? (
            <div className="flex flex-wrap gap-1.5">
              {primary.doctrine_trace.map((item) => (
                <Badge key={item.id} variant="outline" className="text-[10px]">
                  {item.id.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          ) : null}

          {primary.invalidation_rules.length || primary.switching_rules.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border/70 p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Invalidate if</p>
                {primary.invalidation_rules.length ? (
                  <ul className="mt-1 space-y-1 text-[11px]">
                    {primary.invalidation_rules.map((rule, index) => (
                      <li key={"invalidate-" + index}>• {String(rule)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[10px] text-muted-foreground">No explicit invalidation rule supplied.</p>
                )}
              </div>
              <div className="rounded-md border border-border/70 p-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Switch strategy if</p>
                {primary.switching_rules.length ? (
                  <ul className="mt-1 space-y-1 text-[11px]">
                    {primary.switching_rules.map((rule, index) => (
                      <li key={"switch-" + index}>• {String(rule)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[10px] text-muted-foreground">No explicit switching rule supplied.</p>
                )}
              </div>
            </div>
          ) : null}

          {strategic.learning_packet ? (
            <div className="rounded-md bg-muted/25 p-2.5 text-[10px] text-muted-foreground">
              Learning packet pre-registered for {strategic.learning_packet.doctrine_ids.length} doctrine
              {strategic.learning_packet.doctrine_ids.length === 1 ? "" : "s"} before outcome observation.
              Comparator: {strategic.learning_packet.comparator_strategy_id || "none supplied"}.
            </div>
          ) : null}

          {primary.missing_capabilities.length ? (
            <p className="text-[10px] text-muted-foreground">
              Missing capabilities: {primary.missing_capabilities.join(", ")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
          {strategic.comparison_blocked_reason === "mixed_currency_strategy_options_require_verified_fx_normalization"
            ? "Strategic comparison is blocked because economically comparable options use different currencies without verified FX normalization."
            : "No economically comparable strategic option cleared the feasibility and evidence boundaries."}
        </div>
      )}

      {frontier.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold">Pareto frontier</p>
          {frontier.slice(0, 8).map((option) => (
            <div key={option.id} className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{option.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {option.strategy_type.replace(/_/g, " ")}
                  {option.research_only ? " · research only" : ""}
                  {!option.feasible ? " · infeasible" : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold">{option.strategic_fit_score.toFixed(1)}</p>
                <p className="text-[9px] text-muted-foreground">fit</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {strategic.audit ? (
        <div className="rounded-md border border-border/70 bg-muted/20 p-2.5 text-[10px] text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Pre-outcome strategy fingerprint</span>
            <code className="text-foreground">{strategic.audit.hash.slice(0, 16)}…</code>
          </div>
          <p className="mt-1">
            {strategic.audit.algorithm} · {strategic.audit.audit_version} · full hash retained in the response and audit log.
          </p>
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground">{strategic.scope_notice}</p>
    </div>
  );
}

function PortfolioAllocation({ portfolio }: { portfolio: NonNullable<BuildResponse["portfolio"]> }) {
  if (!portfolio.allocation_available) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-xs font-medium">Portfolio allocation unavailable</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          {portfolio.reason === "capital_available_not_configured"
            ? "Set available capital in Opportunity Preferences to enable allocation."
            : portfolio.reason === "mixed_currency_portfolio_requires_verified_fx_layer"
              ? "Mixed-currency allocation is blocked until a verified FX layer is available."
              : portfolio.reason || "No allocation was produced."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">Recommended capital allocation</p>
          <p className="text-[10px] text-muted-foreground">
            {portfolio.optimality_proven ? "Exact best subset within supplied candidates" : "Heuristic allocation across supplied candidates"}
          </p>
        </div>
        <Badge variant="outline">{portfolio.selected_count || 0} positions</Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Capital deployed" value={formatMoney(portfolio.capital_deployed, portfolio.currency)} />
        <Metric label="Cash reserve" value={formatMoney(portfolio.reserve_capital, portfolio.currency)} />
        <Metric label="Expected value" value={formatMoney(portfolio.expected_value, portfolio.currency)} />
        <Metric label="Base-case profit" value={formatMoney(portfolio.base_case_profit, portfolio.currency)} />
      </div>
      {portfolio.selected?.length ? (
        <div className="space-y-1.5">
          {portfolio.selected.map((item) => (
            <div key={item.candidate_id} className="flex items-center justify-between gap-3 rounded-md bg-muted/20 p-2 text-[11px]">
              <div className="min-w-0">
                <p className="truncate text-foreground">{item.title}</p>
                <p className="text-muted-foreground">Expected value {formatMoney(item.expected_value, item.currency || portfolio.currency)}</p>
              </div>
              <div className="shrink-0 font-medium">{formatMoney(item.capital_required, item.currency || portfolio.currency)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No candidate combination cleared the portfolio constraints.</p>
      )}
      {portfolio.optimization_scope_notice ? (
        <p className="text-[10px] text-muted-foreground">{portfolio.optimization_scope_notice}</p>
      ) : null}
    </div>
  );
}

function BuildStats({ result }: { result: BuildResponse }) {
  return (
    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
      <Metric label="Built" value={String(result.build?.candidates?.length ?? 0)} />
      <Metric label="Rejected paths" value={String(result.build?.rejected_paths?.length ?? 0)} />
      <Metric label="Ranked" value={String(result.ranking?.ranked?.length ?? 0)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/25 p-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function formatMoney(value: number | null | undefined, currency?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return ((currency || "") + " " + value.toFixed(2)).trim();
  }
}
