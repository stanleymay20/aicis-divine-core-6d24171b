import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Building2, Loader2, Search, ShieldCheck } from "lucide-react";

type InvestigationRequest = {
  hypothesis_id: string;
  source_signal_id: string;
  source_signal_title: string;
  product: {
    id: string;
    name: string;
    unit: string;
  };
  countries: string[];
};

type DiscoveryCandidate = {
  discovery_id: string;
  role: "supplier" | "buyer" | "logistics";
  title: string;
  description: string;
  discovery_url: string;
  domain: string;
  country_context?: string[];
  contact_channels?: Array<Record<string, unknown>>;
  evidence_refs?: Array<Record<string, unknown>>;
  discovery_fit_score: number;
  verification_status: string;
  transaction_eligible: boolean;
  verification_requirements: string[];
};

type DiscoveryResponse = {
  ok: boolean;
  candidates?: DiscoveryCandidate[];
  discovery_notice?: string;
  code?: string;
  message?: string;
  error?: string;
};

type SanctionsScreenResponse = {
  ok: boolean;
  legal_name?: string;
  screen?: {
    status?: string;
    compliance_status?: string;
    matches?: Array<Record<string, unknown>>;
    missing_sources?: string[];
  };
  coverage?: {
    complete?: boolean;
    checked_sources?: string[];
    missing_sources?: string[];
  };
  sources?: Array<{
    source?: string;
    ok?: boolean;
    evidence_ref?: Record<string, unknown>;
  }>;
  error?: string;
};

type InvestigationState = {
  request: InvestigationRequest;
  supplier: DiscoveryResponse | null;
  buyer: DiscoveryResponse | null;
  source_countries: string[];
  buyer_countries: string[];
};

type VerifiedInputProgress = {
  supplier_country: string | null;
  buyer_country: string | null;
  route_verified: boolean;
};

function uniqueCountries(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 6);
}

async function sha256Json(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function OpportunityInvestigationPanel({
  targetCountries,
  comparisonCurrency,
}: {
  targetCountries: string[];
  comparisonCurrency?: string;
}) {
  const [state, setState] = useState<InvestigationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [buyerMarketText, setBuyerMarketText] = useState("");
  const [logistics, setLogistics] = useState<DiscoveryResponse | null>(null);
  const [logisticsLoading, setLogisticsLoading] = useState(false);
  const [verifiedInputs, setVerifiedInputs] = useState<VerifiedInputProgress>({
    supplier_country: null,
    buyer_country: null,
    route_verified: false,
  });
  const [quantityText, setQuantityText] = useState("");
  const [completionProbabilityText, setCompletionProbabilityText] = useState("");
  const [downsideLossText, setDownsideLossText] = useState("");
  const [cycleDaysText, setCycleDaysText] = useState("");
  const [upsideProfitText, setUpsideProfitText] = useState("");
  const [assumptionsConfirmed, setAssumptionsConfirmed] = useState(false);
  const [economicsBuilding, setEconomicsBuilding] = useState(false);
  const [screeningId, setScreeningId] = useState<string | null>(null);
  const [screenResults, setScreenResults] = useState<Record<string, SanctionsScreenResponse>>({});
  const { toast } = useToast();

  const runDiscovery = useCallback(async (
    request: InvestigationRequest,
    buyerCountriesOverride?: string[],
  ) => {
    const sourceCountries = uniqueCountries(request.countries || []);
    const configuredTargets = uniqueCountries(
      (buyerCountriesOverride?.length ? buyerCountriesOverride : targetCountries)
        .filter((country) => !sourceCountries.includes(country)),
    );

    setLoading(true);

    const supplierPromise = sourceCountries.length
      ? supabase.functions.invoke("discover-transaction-counterparties", {
          body: {
            product_name: request.product.name,
            role: "supplier",
            countries: sourceCountries,
            max_candidates: 8,
          },
        })
      : Promise.resolve({ data: {
          ok: false,
          code: "source_geography_missing",
          message: "The source signal does not contain enough geography to search for suppliers without guessing.",
          candidates: [],
        }, error: null });

    const buyerPromise = configuredTargets.length
      ? supabase.functions.invoke("discover-transaction-counterparties", {
          body: {
            product_name: request.product.name,
            role: "buyer",
            countries: configuredTargets,
            max_candidates: 8,
          },
        })
      : Promise.resolve({ data: {
          ok: false,
          code: "buyer_market_missing",
          message: "Choose a buyer market before AICIS searches for demand-side counterparties.",
          candidates: [],
        }, error: null });

    const [supplierResult, buyerResult] = await Promise.all([supplierPromise, buyerPromise]);
    setLoading(false);

    const supplier: DiscoveryResponse = supplierResult.error
      ? { ok: false, error: supplierResult.error.message, candidates: [] }
      : supplierResult.data as DiscoveryResponse;
    const buyer: DiscoveryResponse = buyerResult.error
      ? { ok: false, error: buyerResult.error.message, candidates: [] }
      : buyerResult.data as DiscoveryResponse;

    setState({
      request,
      supplier,
      buyer,
      source_countries: sourceCountries,
      buyer_countries: configuredTargets,
    });

    const supplierCount = supplier.candidates?.length || 0;
    const buyerCount = buyer.candidates?.length || 0;

    if (supplierCount && buyerCount) {
      toast({
        title: "Counterparty research started",
        description: `AICIS found ${supplierCount} supplier candidate${supplierCount === 1 ? "" : "s"} and ${buyerCount} buyer candidate${buyerCount === 1 ? "" : "s"}. They still require verification.`,
      });
    }
  }, [targetCountries, toast]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<InvestigationRequest>).detail;
      if (!detail?.hypothesis_id || !detail.product?.name) return;
      setBuyerMarketText("");
      setLogistics(null);
      setVerifiedInputs({
        supplier_country: null,
        buyer_country: null,
        route_verified: false,
      });
      setQuantityText("");
      setCompletionProbabilityText("");
      setDownsideLossText("");
      setCycleDaysText("");
      setUpsideProfitText("");
      setAssumptionsConfirmed(false);
      setScreeningId(null);
      setScreenResults({});
      window.dispatchEvent(new CustomEvent("aicis:seed-transaction-bundle", {
        detail: {
          signal: {
            id: detail.source_signal_id,
            title: detail.source_signal_title,
          },
          product: detail.product,
          comparison_currency: /^[A-Z]{3}$/.test(String(comparisonCurrency || "").toUpperCase())
            ? String(comparisonCurrency).toUpperCase()
            : "",
        },
      }));
      void runDiscovery(detail);
    };
    window.addEventListener("aicis:start-opportunity-investigation", handler as EventListener);
    return () => window.removeEventListener("aicis:start-opportunity-investigation", handler as EventListener);
  }, [comparisonCurrency, runDiscovery]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?: "offer" | "route";
        role?: "supplier" | "buyer";
        country?: string | null;
      }>).detail || {};

      if (detail.kind === "offer" && detail.role === "supplier") {
        setVerifiedInputs((current) => ({
          ...current,
          supplier_country: detail.country || current.supplier_country,
        }));
      }
      if (detail.kind === "offer" && detail.role === "buyer") {
        setVerifiedInputs((current) => ({
          ...current,
          buyer_country: detail.country || current.buyer_country,
        }));
      }
      if (detail.kind === "route") {
        setVerifiedInputs((current) => ({ ...current, route_verified: true }));
      }
    };

    window.addEventListener("aicis:transaction-input-verified", handler as EventListener);
    return () => window.removeEventListener("aicis:transaction-input-verified", handler as EventListener);
  }, []);

  const supplierCandidates = state?.supplier?.candidates || [];
  const buyerCandidates = state?.buyer?.candidates || [];
  const buyerMarketMissing = state?.buyer?.code === "buyer_market_missing";
  const logisticsCandidates = logistics?.candidates || [];

  const runLogisticsDiscovery = useCallback(async () => {
    if (!state || !verifiedInputs.supplier_country || !verifiedInputs.buyer_country) return;

    setLogisticsLoading(true);
    const { data, error } = await supabase.functions.invoke("discover-transaction-counterparties", {
      body: {
        product_name: state.request.product.name,
        role: "logistics",
        origin_country: verifiedInputs.supplier_country,
        destination_country: verifiedInputs.buyer_country,
        max_candidates: 8,
      },
    });
    setLogisticsLoading(false);

    const response: DiscoveryResponse = error
      ? { ok: false, error: error.message, candidates: [] }
      : data as DiscoveryResponse;
    setLogistics(response);
  }, [state, verifiedInputs.buyer_country, verifiedInputs.supplier_country]);

  useEffect(() => {
    if (
      verifiedInputs.supplier_country &&
      verifiedInputs.buyer_country &&
      !logistics &&
      !logisticsLoading
    ) {
      void runLogisticsDiscovery();
    }
  }, [
    logistics,
    logisticsLoading,
    runLogisticsDiscovery,
    verifiedInputs.buyer_country,
    verifiedInputs.supplier_country,
  ]);

  const researchBlocked = Boolean(
    state && (
      !supplierCandidates.length ||
      !buyerCandidates.length
    ),
  );

  const blockers = useMemo(() => {
    if (!state) return [];
    const next: string[] = [];
    if (!state.source_countries.length) next.push("source geography");
    if (state.supplier?.code === "firecrawl_not_configured") next.push("counterparty discovery service");
    if (!supplierCandidates.length && state.supplier?.code !== "firecrawl_not_configured") next.push("supplier candidate");
    if (!state.buyer_countries.length) next.push("buyer market");
    else if (!buyerCandidates.length) next.push("buyer candidate");
    if (supplierCandidates.length && !verifiedInputs.supplier_country) next.push("verified supplier");
    if (buyerCandidates.length && !verifiedInputs.buyer_country) next.push("verified buyer");
    if (verifiedInputs.supplier_country && verifiedInputs.buyer_country && !logisticsCandidates.length) next.push("logistics candidate");
    if (logisticsCandidates.length && !verifiedInputs.route_verified) next.push("verified route");
    return next;
  }, [
    buyerCandidates.length,
    logisticsCandidates.length,
    state,
    supplierCandidates.length,
    verifiedInputs.buyer_country,
    verifiedInputs.route_verified,
    verifiedInputs.supplier_country,
  ]);

  const screen = async (candidate: DiscoveryCandidate) => {
    setScreeningId(candidate.discovery_id);
    const { data, error } = await supabase.functions.invoke("screen-transaction-counterparty", {
      body: {
        legal_name: candidate.title || candidate.domain,
      },
    });
    setScreeningId(null);

    if (error) {
      toast({
        title: "Official-list screening unavailable",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const response = data as SanctionsScreenResponse;
    setScreenResults((current) => ({
      ...current,
      [candidate.discovery_id]: response,
    }));
  };

  const prepareVerification = (candidate: DiscoveryCandidate) => {
    const screenResult = screenResults[candidate.discovery_id];
    const complianceEvidence = (screenResult?.sources || [])
      .filter((source) => source.ok && source.evidence_ref)
      .map((source) => source.evidence_ref as Record<string, unknown>);
    const screenedAt = new Date().toISOString();
    const jurisdiction = candidate.country_context?.length === 1
      ? candidate.country_context[0]
      : "";

    const advanced = document.getElementById("opportunity-advanced-workspace") as HTMLDetailsElement | null;
    if (advanced) advanced.open = true;

    if (candidate.role === "logistics") {
      window.dispatchEvent(new CustomEvent("aicis:prepare-logistics-route", {
        detail: {
          dossier: {
            as_of: screenedAt,
            provider: {
              legal_name: candidate.title || candidate.domain,
              jurisdiction,
              registration_id: "",
              evidence_refs: [],
            },
            compliance: {
              status: "review",
              screened_at: screenedAt,
              evidence_refs: complianceEvidence,
            },
            route_quote: {
              quote_id: "",
              route_name: "",
              origin_country: verifiedInputs.supplier_country || "",
              destination_country: verifiedInputs.buyer_country || "",
              transit_days: 0,
              valid_until: "",
              evidence_status: "verified_quote",
              evidence_refs: [],
              stops: [],
              costs: [{
                type: "freight",
                amount: 0,
                basis: "per_unit",
                currency: "",
                evidence_refs: [],
              }],
            },
            capacity: {
              status: "verified",
              evidence_refs: [],
            },
            contact_channels: candidate.contact_channels || [],
            evidence_score: 0,
            capacity_score: 50,
          },
        },
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent("aicis:verify-counterparty", {
      detail: {
        dossier: {
          as_of: screenedAt,
          role: candidate.role,
          legal_identity: {
            legal_name: candidate.title || candidate.domain,
            jurisdiction,
            registration_id: "",
            evidence_refs: [],
          },
          official_site: {
            domain: candidate.domain,
            url: candidate.discovery_url,
            evidence_refs: [],
          },
          compliance: {
            status: "review",
            screened_at: screenedAt,
            evidence_refs: complianceEvidence,
          },
          commercial_quote: {
            quote_id: "",
            product_id: state?.request.product.id || "",
            unit_price: 0,
            currency: "",
            min_quantity: null,
            max_quantity: null,
            incoterm: "",
            valid_until: "",
            evidence_status: "verified_quote",
            evidence_refs: [],
          },
          capacity: {
            status: "verified",
            evidence_refs: [],
          },
          payment_terms: {
            terms: "",
            evidence_refs: [],
          },
          contact_channels: candidate.contact_channels || [],
          evidence_score: 0,
          counterparty_quality_score: 50,
        },
      },
    }));
  };

  const buildResearchEconomics = async () => {
    const quantity = Number(quantityText);
    const probability = Number(completionProbabilityText);
    const downsideLoss = Number(downsideLossText);
    const cycleDays = Number(cycleDaysText);
    const upsideProfit = upsideProfitText.trim() === "" ? null : Number(upsideProfitText);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({ title: "Quantity required", description: "Enter a positive quantity to evaluate.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
      toast({ title: "Completion probability required", description: "Enter a research assumption from 0 to 100.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(downsideLoss) || downsideLoss < 0) {
      toast({ title: "Downside assumption required", description: "Enter a non-negative downside amount.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(cycleDays) || cycleDays <= 0) {
      toast({ title: "Cycle assumption required", description: "Enter a positive expected cycle in days.", variant: "destructive" });
      return;
    }
    if (upsideProfit != null && (!Number.isFinite(upsideProfit) || upsideProfit < 0)) {
      toast({ title: "Upside assumption invalid", description: "Leave upside blank or enter a non-negative amount.", variant: "destructive" });
      return;
    }
    if (!assumptionsConfirmed) {
      toast({
        title: "Confirm assumption semantics",
        description: "Confirm these are your current research assumptions, not observed facts or guaranteed outcomes.",
        variant: "destructive",
      });
      return;
    }

    setEconomicsBuilding(true);
    const observedAt = new Date().toISOString();
    const declaredScenario = {
      probability_of_completion: probability,
      downside_loss: downsideLoss,
      upside_profit: upsideProfit,
      cycle_days: cycleDays,
      semantics: "user_declared_research_assumption_not_empirically_calibrated",
    };
    const digest = await sha256Json(declaredScenario);

    window.dispatchEvent(new CustomEvent("aicis:configure-research-economics", {
      detail: {
        quantity,
        scenario: {
          calibration_status: "validated_input",
          probability_of_completion: probability,
          downside_loss: downsideLoss,
          upside_profit: upsideProfit,
          cycle_days: cycleDays,
          evidence_score: 25,
          evidence_semantics: "user_declared_research_assumption_not_empirically_calibrated",
          evidence_refs: [{
            source_id: "user_declared_scenario_assumption",
            source_type: "user_declared_assumption",
            observed_at: observedAt,
            sha256: digest,
          }],
        },
        structure: {
          transaction_type: "physical_trade",
          capital_model: "full_landed_cost",
          compliance_status: "clear",
          costs: [],
          assumptions: [{
            kind: "research_baseline_structure",
            statement: "Direct physical trade is being evaluated as a research baseline; it is not asserted to be the optimal transaction structure.",
          }],
        },
      },
    }));

    window.setTimeout(() => setEconomicsBuilding(false), 800);
  };

  if (!state && !loading) return null;

  return (
    <Card id="opportunity-investigation">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 text-primary" />
              Transaction investigation
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {state?.request.product.name || "Opportunity"} · discovery becomes a transaction only after evidence and verification gates pass.
            </p>
          </div>
          <Badge variant="secondary">{loading ? "RESEARCHING" : researchBlocked ? "RESEARCHING" : "COUNTERPARTIES FOUND"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            AICIS is searching for attributable supplier and buyer candidates…
          </div>
        ) : state ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <CandidateColumn
                title="Supplier side"
                countries={state.source_countries}
                candidates={supplierCandidates}
                message={state.supplier?.message || state.supplier?.error}
                screeningId={screeningId}
                screenResults={screenResults}
                onScreen={screen}
                onPrepareVerification={prepareVerification}
              />
              <CandidateColumn
                title="Buyer side"
                countries={state.buyer_countries}
                candidates={buyerCandidates}
                message={state.buyer?.message || state.buyer?.error}
                screeningId={screeningId}
                screenResults={screenResults}
                onScreen={screen}
                onPrepareVerification={prepareVerification}
              />
            </div>

            {buyerMarketMissing ? (
              <div className="rounded-md border border-dashed p-3">
                <p className="text-xs font-medium">One thing is missing: where should AICIS look for buyers?</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={buyerMarketText}
                    onChange={(event) => setBuyerMarketText(event.target.value)}
                    placeholder="e.g. Germany, Netherlands"
                  />
                  <Button
                    variant="outline"
                    disabled={!buyerMarketText.trim()}
                    onClick={() => void runDiscovery(
                      state.request,
                      buyerMarketText.split(",").map((value) => value.trim()).filter(Boolean),
                    )}
                  >
                    Search buyers
                  </Button>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  AICIS does not invent a destination market when one is not evidenced or configured.
                </p>
              </div>
            ) : null}

            {verifiedInputs.supplier_country && verifiedInputs.buyer_country ? (
              <div className="space-y-2">
                <p className="text-xs font-medium">Route research</p>
                {logisticsLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    AICIS is looking for logistics candidates between {verifiedInputs.supplier_country} and {verifiedInputs.buyer_country}…
                  </div>
                ) : (
                  <CandidateColumn
                    title="Logistics side"
                    countries={[verifiedInputs.supplier_country, verifiedInputs.buyer_country]}
                    candidates={logisticsCandidates}
                    message={logistics?.message || logistics?.error}
                    screeningId={screeningId}
                    screenResults={screenResults}
                    onScreen={screen}
                    onPrepareVerification={prepareVerification}
                  />
                )}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-4">
              <ProgressStep
                label="Discover"
                complete={supplierCandidates.length > 0 && buyerCandidates.length > 0}
                detail="supplier + buyer candidates"
              />
              <ProgressStep
                label="Verify parties"
                complete={Boolean(verifiedInputs.supplier_country && verifiedInputs.buyer_country)}
                detail="identity + quote + compliance"
              />
              <ProgressStep
                label="Verify route"
                complete={verifiedInputs.route_verified}
                detail="provider + route quote"
              />
              <ProgressStep
                label="Build economics"
                complete={false}
                detail="FX + landed cost + strategy"
              />
            </div>

            {verifiedInputs.route_verified ? (
              <div className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">Research economics</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Set the quantity and your current scenario assumptions. AICIS will calculate research economics from verified supplier, buyer and route inputs, but will keep this below review-grade until landed costs and stronger scenario evidence clear the gates.
                    </p>
                  </div>
                  <Badge variant="secondary">assumptions ≠ facts</Badge>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Input
                    inputMode="decimal"
                    value={quantityText}
                    onChange={(event) => setQuantityText(event.target.value)}
                    placeholder={state.request.product.unit ? `Quantity (${state.request.product.unit})` : "Quantity"}
                  />
                  <Input
                    inputMode="decimal"
                    value={completionProbabilityText}
                    onChange={(event) => setCompletionProbabilityText(event.target.value)}
                    placeholder="Completion %"
                  />
                  <Input
                    inputMode="decimal"
                    value={downsideLossText}
                    onChange={(event) => setDownsideLossText(event.target.value)}
                    placeholder="Downside amount"
                  />
                  <Input
                    inputMode="numeric"
                    value={cycleDaysText}
                    onChange={(event) => setCycleDaysText(event.target.value)}
                    placeholder="Cycle days"
                  />
                  <Input
                    inputMode="decimal"
                    value={upsideProfitText}
                    onChange={(event) => setUpsideProfitText(event.target.value)}
                    placeholder="Upside (optional)"
                  />
                </div>

                <label className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5"
                    checked={assumptionsConfirmed}
                    onChange={(event) => setAssumptionsConfirmed(event.target.checked)}
                  />
                  <span>
                    I confirm these are current research assumptions supplied for analysis. They are not observed facts, independently calibrated probabilities, promises of profit or execution instructions.
                  </span>
                </label>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground">
                    First path tested: direct physical trade. Alternative structures remain a later strategic comparison, not an assumption that direct ownership is best.
                  </p>
                  <Button size="sm" onClick={buildResearchEconomics} disabled={economicsBuilding}>
                    {economicsBuilding ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Calculate research economics
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/20 p-3">
              <div>
                <p className="text-xs font-medium">
                  {blockers.length ? "Next verification work" : "Ready for counterparty verification"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {blockers.length
                    ? `Still missing: ${blockers.join(" · ")}. Discovery candidates are not verified companies or quotes.`
                    : "Screen the strongest supplier and buyer candidates, obtain current attributable quotes, then build the route and landed-cost path."}
                </p>
              </div>
              {!blockers.length ? (
                <Badge variant="outline" className="gap-1.5">
                  <ShieldCheck className="h-3 w-3" />
                  verification next
                </Badge>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProgressStep({
  label,
  complete,
  detail,
}: {
  label: string;
  complete: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border/70 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium">{label}</p>
        <Badge variant={complete ? "outline" : "secondary"} className="text-[9px]">
          {complete ? "done" : "next"}
        </Badge>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function CandidateColumn({
  title,
  countries,
  candidates,
  message,
  screeningId,
  screenResults,
  onScreen,
  onPrepareVerification,
}: {
  title: string;
  countries: string[];
  candidates: DiscoveryCandidate[];
  message?: string;
  screeningId: string | null;
  screenResults: Record<string, SanctionsScreenResponse>;
  onScreen: (candidate: DiscoveryCandidate) => void | Promise<void>;
  onPrepareVerification: (candidate: DiscoveryCandidate) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{title}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {countries.length ? countries.join(", ") : "market not configured"}
          </p>
        </div>
        <Badge variant="outline">{candidates.length} found</Badge>
      </div>

      {candidates.length ? (
        <div className="mt-3 space-y-2">
          {candidates.slice(0, 3).map((candidate) => (
            <div key={candidate.discovery_id} className="rounded-md bg-muted/20 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{candidate.title || candidate.domain}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{candidate.domain}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[9px]">
                  fit {Math.round(candidate.discovery_fit_score)}
                </Badge>
              </div>
              {screenResults[candidate.discovery_id] ? (
                <div className="mt-2 rounded-md border border-border/60 p-2 text-[10px] text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Official lists: {screenResults[candidate.discovery_id].screen?.status?.replaceAll("_", " ") || "screened"}
                    </span>
                    <Badge
                      variant={screenResults[candidate.discovery_id].screen?.status === "review_required_potential_match"
                        ? "destructive"
                        : "outline"}
                      className="text-[9px]"
                    >
                      {screenResults[candidate.discovery_id].coverage?.complete ? "4-source coverage" : "partial coverage"}
                    </Badge>
                  </div>
                  <p className="mt-1">
                    {screenResults[candidate.discovery_id].screen?.status === "complete_screen_no_match"
                      ? "No exact match was found across the checked official lists. Human compliance review is still required."
                      : screenResults[candidate.discovery_id].screen?.status === "review_required_potential_match"
                        ? "A potential exact-name or identifier match requires human compliance review before proceeding."
                        : "Coverage or matching remains unresolved; this is not compliance clearance."}
                  </p>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={screeningId === candidate.discovery_id}
                  onClick={() => void onScreen(candidate)}
                >
                  {screeningId === candidate.discovery_id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Building2 className="h-3 w-3" />}
                  Official-list check
                </Button>
                {screenResults[candidate.discovery_id] ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => onPrepareVerification(candidate)}
                  >
                    Prepare verification
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {message || "No candidates are available yet."}
        </p>
      )}
    </div>
  );
}
