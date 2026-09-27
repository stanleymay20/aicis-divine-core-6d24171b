import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, CheckCircle2, CircleDollarSign, Compass, Loader2, MapPin, RefreshCw, ShieldAlert, Users } from "lucide-react";

type RankItem = {
  candidate_id: string;
  title: string;
  transaction_type: string;
  score: number;
  execution_ready: boolean;
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
      source?: { name?: string; country?: string; unit_price?: number; currency?: string } | null;
      destination?: { name?: string; country?: string; unit_price?: number; currency?: string } | null;
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
  effective_date?: string;
  error?: string;
  message?: string;
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

export function TransactionPathLab() {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<BuildResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fxLoading, setFxLoading] = useState(false);
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
    toast({
      title: "ECB reference FX added",
      description: `${response.rates.length} reference rates added for research comparison only. Executable FX is still required before transaction approval.`,
    });
  };

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
                {primary.strategy_type.replaceAll("_", " ")} · {primary.directness}
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
                  {item.id.replaceAll("_", " ")}
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
                  {option.strategy_type.replaceAll("_", " ")}
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
