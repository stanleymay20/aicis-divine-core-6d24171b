import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Calculator, CheckCircle2, ExternalLink, Loader2, Search, ShieldAlert } from "lucide-react";

const REQUIRED_CATEGORIES = [
  "origin_inland_transport",
  "origin_handling",
  "export_customs",
  "export_duty_tax",
  "international_freight",
  "cargo_insurance",
  "import_duty",
  "import_tax",
  "customs_brokerage",
  "destination_handling",
  "inspection_certification",
  "financing",
  "storage_distribution",
] as const;

type EvidenceRef = Record<string, unknown>;

export type LandedCostCandidate = {
  id: string;
  title: string;
  transaction_type: string;
  product?: {
    id?: string | null;
    name?: string | null;
    unit?: string | null;
    specification?: string | null;
    hs_code?: string | null;
  } | null;
  quantity?: number | null;
  unit?: string | null;
  currency?: string | null;
  source_offer?: {
    id?: string | null;
    name?: string | null;
    country?: string | null;
  } | null;
  sale_offer?: {
    id?: string | null;
    name?: string | null;
    country?: string | null;
  } | null;
  logistics?: {
    route_id?: string | null;
    route_name?: string | null;
  } | null;
  cost_breakdown?: Array<{
    type?: string | null;
    amount?: number | null;
    currency?: string | null;
    evidence_refs?: EvidenceRef[];
  }>;
  landed_cost_complete?: boolean;
  landed_cost_execution_ready?: boolean;
  landed_cost_missing_fields?: string[];
};

type VerificationResponse = {
  ok: boolean;
  verification_version?: string;
  candidate_id?: string | null;
  product_id?: string | null;
  hs_code?: string | null;
  origin_country?: string | null;
  destination_country?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  comparison_currency?: string | null;
  coverage_complete?: boolean;
  research_complete?: boolean;
  execution_ready_cost_stack?: boolean;
  missing_categories?: string[];
  invalid_coverage?: Array<{ category: string; reason: string }>;
  invalid_components?: Array<{
    component_id: string | null;
    category: string;
    reasons: string[];
  }>;
  components?: Array<Record<string, unknown>>;
  supplemental_landed_cost?: number;
  recoverable_tax_cash_flow?: number;
  supplemental_cash_requirement?: number;
  normalized_structure_costs?: Array<Record<string, unknown>>;
  evidence_refs?: EvidenceRef[];
  missing_execution_fields?: string[];
  research_tasks?: Array<{
    category?: string;
    component_id?: string | null;
    required_evidence?: string;
    suggested_next_step?: string;
  }>;
  transaction_eligible?: false;
  semantics?: string;
  scope_notice?: string;
  request_reasons?: string[];
  audit?: {
    hash?: string;
    algorithm?: string;
  };
  error?: string;
};

type OfficialSourcePlanResponse = {
  ok: boolean;
  classification_ready?: boolean;
  sources?: Array<{
    source_id: string;
    authority: string;
    jurisdiction: string;
    source_type: string;
    consultation_url?: string;
    overview_url?: string;
    help_url?: string;
    requested_categories: string[];
    reason: string;
    status: string;
    explicitly_not_covered?: string[];
    rate_extracted: false;
    legal_determination_made: false;
  }>;
  blockers?: Array<{
    kind: string;
    priority: string;
    jurisdiction?: string;
    categories?: string[];
    reason: string;
    provider_status?: string;
  }>;
  automated_rate_extraction_performed?: false;
  customs_rate?: null;
  tax_rate?: null;
  scope_notice?: string;
  error?: string;
};


export type LandedCostPack = {
  source_id: string;
  buyer_id: string;
  route_id: string;
  transaction_type: string;
  candidate_id: string;
  product_id: string;
  quantity: number;
  quantity_unit: string;
  comparison_currency: string;
  evidence: VerificationResponse;
  audit?: VerificationResponse["audit"];
};

function iso3OrBlank(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

function exactCoveredCost(
  candidate: LandedCostCandidate,
  category: typeof REQUIRED_CATEGORIES[number],
) {
  const aliases: Partial<Record<typeof REQUIRED_CATEGORIES[number], string[]>> = {
    international_freight: ["international_freight", "freight"],
    cargo_insurance: ["cargo_insurance", "insurance"],
    inspection_certification: ["inspection_certification", "inspection"],
  };
  const accepted = aliases[category] || [category];

  return (candidate.cost_breakdown || []).find((cost) => {
    const type = String(cost.type || "").trim().toLowerCase();
    return accepted.includes(type) &&
      Array.isArray(cost.evidence_refs) &&
      cost.evidence_refs.length > 0;
  });
}

function buildSeed(candidate: LandedCostCandidate, fxRates: Array<Record<string, unknown>>) {
  const coverage = REQUIRED_CATEGORIES.map((category) => {
    const covered = exactCoveredCost(candidate, category);
    if (!covered) return { category, status: "unknown" };

    return {
      category,
      status: "covered_elsewhere",
      existing_cost_id: "candidate-cost:" + String(covered.type || category),
      evidence_refs: covered.evidence_refs || [],
    };
  });

  return {
    as_of: new Date().toISOString(),
    candidate_id: candidate.id,
    product_id: candidate.product?.id || "",
    hs_code: candidate.product?.hs_code || "",
    origin_country: iso3OrBlank(candidate.source_offer?.country),
    destination_country: iso3OrBlank(candidate.sale_offer?.country),
    quantity: candidate.quantity ?? null,
    quantity_unit: candidate.unit || candidate.product?.unit || "",
    comparison_currency: candidate.currency || "",
    coverage,
    components: [],
    fx_rates: fxRates,
  };
}

function formatMoney(value?: number, currency?: string | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return value.toLocaleString();
    }
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function LandedCostVerificationPanel({
  candidate,
  fxRates,
  onAttach,
}: {
  candidate: LandedCostCandidate;
  fxRates: Array<Record<string, unknown>>;
  onAttach: (pack: LandedCostPack) => void;
}) {
  const [payload, setPayload] = useState(() =>
    JSON.stringify(buildSeed(candidate, fxRates), null, 2)
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResponse | null>(null);
  const [sourcePlanLoading, setSourcePlanLoading] = useState(false);
  const [sourcePlan, setSourcePlan] = useState<OfficialSourcePlanResponse | null>(null);
  const { toast } = useToast();

  const candidateLabel = useMemo(() => {
    const source = candidate.source_offer?.name || "source";
    const buyer = candidate.sale_offer?.name || "buyer";
    return source + " → " + buyer;
  }, [candidate.source_offer?.name, candidate.sale_offer?.name]);

  const planOfficialSources = async () => {
    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Landed-cost bundle must be a JSON object.");
      }
      input = parsed as Record<string, unknown>;
    } catch (error) {
      toast({
        title: "Invalid landed-cost JSON",
        description: error instanceof Error ? error.message : "Fix the evidence bundle first.",
        variant: "destructive",
      });
      return;
    }

    setSourcePlanLoading(true);
    const { data, error } = await supabase.functions.invoke("plan-official-customs-evidence-sources", {
      body: {
        input: {
          origin_country: input.origin_country,
          destination_country: input.destination_country,
          hs_code: input.hs_code,
        },
      },
    });
    setSourcePlanLoading(false);

    if (error) {
      toast({
        title: "Official customs source plan unavailable",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const response = data as OfficialSourcePlanResponse;
    setSourcePlan(response);
    if (!response.ok) {
      toast({
        title: "Customs source plan needs more context",
        description: response.error || "Provide valid origin and destination ISO3 codes.",
        variant: "destructive",
      });
    }
  };

  const verify = async () => {
    let input: unknown;
    try {
      input = JSON.parse(payload);
    } catch {
      toast({
        title: "Invalid landed-cost JSON",
        description: "Fix the evidence bundle before verification.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("verify-landed-cost-evidence", {
      body: { input },
    });
    setLoading(false);

    if (error) {
      toast({
        title: "Landed-cost verification failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const response = data as VerificationResponse;
    setResult(response);
    if (!response.ok) {
      toast({
        title: "Landed-cost request rejected",
        description: response.request_reasons?.join(", ") || response.error || "The evidence bundle is invalid.",
        variant: "destructive",
      });
    }
  };

  const attach = () => {
    if (!result?.coverage_complete) return;

    const sourceId = String(candidate.source_offer?.id || "");
    const buyerId = String(candidate.sale_offer?.id || "");
    const routeId = String(candidate.logistics?.route_id || "");
    if (!sourceId || !buyerId || !routeId || !candidate.transaction_type) {
      toast({
        title: "Transaction scope incomplete",
        description: "Supplier, buyer, route and transaction type are required before this evidence can be attached.",
        variant: "destructive",
      });
      return;
    }

    const candidateId = String(result.candidate_id || candidate.id || "");
    const productId = String(result.product_id || candidate.product?.id || "");
    const quantity = Number(result.quantity ?? candidate.quantity);
    const quantityUnit = String(result.quantity_unit || candidate.unit || candidate.product?.unit || "");
    const comparisonCurrency = String(result.comparison_currency || candidate.currency || "").toUpperCase();

    if (!candidateId || !productId || !Number.isFinite(quantity) || quantity <= 0 || !quantityUnit || !/^[A-Z]{3}$/.test(comparisonCurrency)) {
      toast({
        title: "Verified scope incomplete",
        description: "Candidate, product, quantity, unit and comparison currency must all be bound before this evidence pack can be attached.",
        variant: "destructive",
      });
      return;
    }

    onAttach({
      source_id: sourceId,
      buyer_id: buyerId,
      route_id: routeId,
      transaction_type: candidate.transaction_type,
      candidate_id: candidateId,
      product_id: productId,
      quantity,
      quantity_unit: quantityUnit,
      comparison_currency: comparisonCurrency,
      evidence: result,
      audit: result.audit,
    });
  };

  return (
    <div id="landed-cost-verification" className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Landed Cost Verification</p>
          </div>
          <p className="mt-1 max-w-3xl text-[10px] text-muted-foreground">
            Evidence every material border, logistics and financing cost before AICIS treats physical-trade economics as complete.
            Recoverable tax is tracked as cash required, not automatically treated as economic cost.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{candidateLabel}</Badge>
          <Badge variant={candidate.landed_cost_complete ? "outline" : "secondary"}>
            {candidate.landed_cost_complete ? "cost coverage attached" : "cost coverage incomplete"}
          </Badge>
        </div>
      </div>

      <div className="rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
        AICIS does not infer HS classification, tariff rate, tax recoverability, customs value, insurance coverage or financing terms.
        Use official rules or current attributable commercial evidence. Unknown remains unknown.
      </div>

      <Textarea
        value={payload}
        onChange={(event) => {
          setPayload(event.target.value);
          setResult(null);
          setSourcePlan(null);
        }}
        className="min-h-[420px] font-mono text-xs"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-muted-foreground">
          Existing freight, insurance or inspection costs are marked covered elsewhere only when this candidate already carries attributable evidence.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={planOfficialSources}
            disabled={sourcePlanLoading}
            className="gap-2"
          >
            {sourcePlanLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Search className="h-4 w-4" />}
            Plan official customs sources
          </Button>
          <Button type="button" size="sm" onClick={verify} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Verify landed cost
          </Button>
        </div>
      </div>

      {sourcePlan ? (
        <div className="rounded-md border border-border/70 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold">Official customs evidence sources</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Source routing only. No tariff or tax rate has been extracted or written into this transaction.
              </p>
            </div>
            <Badge variant={sourcePlan.classification_ready ? "outline" : "secondary"}>
              {sourcePlan.classification_ready ? "classification supplied" : "classification unresolved"}
            </Badge>
          </div>

          {sourcePlan.sources?.length ? (
            <div className="space-y-2">
              {sourcePlan.sources.map((source) => (
                <div key={source.source_id + ":" + source.requested_categories.join(",")} className="rounded-md bg-muted/20 p-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-medium">{source.authority}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {source.requested_categories.join(", ")} · {source.reason}
                      </p>
                      {source.explicitly_not_covered?.length ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Does not supply: {source.explicitly_not_covered.join(", ")}
                        </p>
                      ) : null}
                    </div>
                    {source.consultation_url ? (
                      <a
                        href={source.consultation_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        Official source
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {sourcePlan.blockers?.length ? (
            <div className="space-y-1.5">
              {sourcePlan.blockers.map((blocker, index) => (
                <div key={blocker.kind + ":" + index} className="rounded-md border border-dashed p-2.5 text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">{blocker.kind.replaceAll("_", " ")}:</span>{" "}
                  {blocker.reason}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              automated rate extraction=false · legal determination=false · customs rate=null · tax rate=null.
            </span>
          </div>
          {sourcePlan.scope_notice ? (
            <p className="text-[10px] text-muted-foreground">{sourcePlan.scope_notice}</p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Economic cost added"
              value={formatMoney(result.supplemental_landed_cost, result.comparison_currency)}
            />
            <Metric
              label="Recoverable tax cash"
              value={formatMoney(result.recoverable_tax_cash_flow, result.comparison_currency)}
            />
            <Metric
              label="Cash requirement added"
              value={formatMoney(result.supplemental_cash_requirement, result.comparison_currency)}
            />
            <Metric
              label="Execution-grade"
              value={result.execution_ready_cost_stack ? "yes" : "no"}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant={result.coverage_complete ? "outline" : "destructive"}>
              {result.coverage_complete ? "coverage complete" : "coverage incomplete"}
            </Badge>
            <Badge variant={result.execution_ready_cost_stack ? "outline" : "secondary"}>
              {result.execution_ready_cost_stack ? "execution-grade cost evidence" : "research-only cost evidence"}
            </Badge>
            <Badge variant="secondary">transaction eligible: no</Badge>
          </div>

          {result.missing_categories?.length ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-semibold">Missing cost coverage</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {result.missing_categories.join(" · ")}
              </p>
            </div>
          ) : null}

          {result.invalid_coverage?.length || result.invalid_components?.length ? (
            <div className="rounded-md border border-border/70 p-3 space-y-1">
              <p className="text-xs font-semibold">Evidence blockers</p>
              {(result.invalid_coverage || []).map((item) => (
                <p key={item.category + ":" + item.reason} className="text-[10px] text-muted-foreground">
                  {item.category}: {item.reason}
                </p>
              ))}
              {(result.invalid_components || []).map((item, index) => (
                <p key={(item.component_id || item.category) + ":" + index} className="text-[10px] text-muted-foreground">
                  {item.category}{item.component_id ? " (" + item.component_id + ")" : ""}: {item.reasons.join(", ")}
                </p>
              ))}
            </div>
          ) : null}

          {result.research_tasks?.length ? (
            <div className="rounded-md border border-border/70 p-3 space-y-2">
              <p className="text-xs font-semibold">Next evidence tasks</p>
              {result.research_tasks.slice(0, 8).map((task, index) => (
                <div key={(task.category || task.component_id || "task") + ":" + index} className="text-[10px] text-muted-foreground">
                  <span className="text-foreground">{task.category || task.component_id || "Evidence"}:</span>{" "}
                  {task.required_evidence || task.suggested_next_step || "Additional attributable evidence required."}
                </div>
              ))}
            </div>
          ) : null}

          {result.coverage_complete ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs font-medium">
                    {result.execution_ready_cost_stack
                      ? "Complete execution-grade cost evidence"
                      : "Complete for research; execution evidence still incomplete"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Attach this pack and rebuild. The previous profit ranking becomes stale because costs/cash requirements changed.
                  </p>
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={attach}>
                Attach cost evidence & rebuild
              </Button>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Customs not filed · insurance not bound · financing not accepted · payment not made · no order or contract executed.
            </span>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Evidence fingerprint: <code>{result.audit?.hash?.slice(0, 16) || "—"}…</code>
          </p>
          {result.scope_notice ? <p className="text-[10px] text-muted-foreground">{result.scope_notice}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-semibold">{value}</p>
    </div>
  );
}
