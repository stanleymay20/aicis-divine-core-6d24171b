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

type InvestigationState = {
  request: InvestigationRequest;
  supplier: DiscoveryResponse | null;
  buyer: DiscoveryResponse | null;
  source_countries: string[];
  buyer_countries: string[];
};

function uniqueCountries(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 6);
}

export function OpportunityInvestigationPanel({ targetCountries }: { targetCountries: string[] }) {
  const [state, setState] = useState<InvestigationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [buyerMarketText, setBuyerMarketText] = useState("");
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
      void runDiscovery(detail);
    };
    window.addEventListener("aicis:start-opportunity-investigation", handler as EventListener);
    return () => window.removeEventListener("aicis:start-opportunity-investigation", handler as EventListener);
  }, [runDiscovery]);

  const supplierCandidates = state?.supplier?.candidates || [];
  const buyerCandidates = state?.buyer?.candidates || [];
  const buyerMarketMissing = state?.buyer?.code === "buyer_market_missing";
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
    return next;
  }, [buyerCandidates.length, state, supplierCandidates.length]);

  const screen = (candidate: DiscoveryCandidate) => {
    const advanced = document.getElementById("opportunity-advanced-workspace") as HTMLDetailsElement | null;
    if (advanced) advanced.open = true;
    window.dispatchEvent(new CustomEvent("aicis:screen-counterparty", {
      detail: {
        legal_name: candidate.title || candidate.domain,
        role: candidate.role,
      },
    }));
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
                onScreen={screen}
              />
              <CandidateColumn
                title="Buyer side"
                countries={state.buyer_countries}
                candidates={buyerCandidates}
                message={state.buyer?.message || state.buyer?.error}
                onScreen={screen}
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

function CandidateColumn({
  title,
  countries,
  candidates,
  message,
  onScreen,
}: {
  title: string;
  countries: string[];
  candidates: DiscoveryCandidate[];
  message?: string;
  onScreen: (candidate: DiscoveryCandidate) => void;
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
              <div className="mt-2 flex justify-end">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => onScreen(candidate)}>
                  <Building2 className="h-3 w-3" />
                  Screen
                  <ArrowRight className="h-3 w-3" />
                </Button>
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
