import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Building2, Loader2, Search, ShieldAlert } from "lucide-react";

type Candidate = {
  discovery_id: string;
  role: string;
  title: string;
  description: string;
  discovery_url: string;
  domain: string;
  discovery_fit_score: number;
  verification_status: string;
  transaction_eligible: boolean;
  contact_channels: Array<{
    type: string;
    value: string;
    source_url?: string;
  }>;
  verification_requirements: string[];
};

type Response = {
  ok: boolean;
  candidates?: Candidate[];
  discovery_notice?: string;
  error?: string;
  message?: string;
};

export function CounterpartyDiscoveryPanel() {
  const [product, setProduct] = useState("");
  const [role, setRole] = useState<"supplier" | "buyer" | "logistics">("supplier");
  const [countriesText, setCountriesText] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [destinationCountry, setDestinationCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<Response | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        product?: string;
        countries?: string[];
        role?: "supplier" | "buyer" | "logistics";
        origin_country?: string;
        destination_country?: string;
      }>).detail || {};
      if (detail.product) setProduct(detail.product);
      if (Array.isArray(detail.countries)) setCountriesText(detail.countries.join(", "));
      if (detail.role === "supplier" || detail.role === "buyer" || detail.role === "logistics") setRole(detail.role);
      if (detail.origin_country) setOriginCountry(detail.origin_country);
      if (detail.destination_country) setDestinationCountry(detail.destination_country);
      window.requestAnimationFrame(() => {
        document.getElementById("counterparty-discovery")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    window.addEventListener("aicis:investigate-product", handler as EventListener);
    return () => window.removeEventListener("aicis:investigate-product", handler as EventListener);
  }, []);

  const countries = useMemo(
    () => countriesText.split(",").map((value) => value.trim()).filter(Boolean),
    [countriesText],
  );

  const discover = async () => {
    if (!product.trim()) {
      toast({ title: "Product required", description: "Enter the product or commodity you want to source or sell.", variant: "destructive" });
      return;
    }
    if (role !== "logistics" && countries.length === 0) {
      toast({ title: "Country required", description: "Add at least one target country.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("discover-transaction-counterparties", {
      body: {
        product_name: product.trim(),
        role,
        countries,
        origin_country: originCountry.trim(),
        destination_country: destinationCountry.trim(),
        max_candidates: 12,
      },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Discovery failed", description: error.message, variant: "destructive" });
      return;
    }

    const result = data as Response;
    setResponse(result);
    if (!result.ok) {
      toast({
        title: "Discovery unavailable",
        description: result.message || result.error || "No counterparty discovery result was returned.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card id="counterparty-discovery">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          Counterparty Discovery
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Find candidate suppliers, buyers, and logistics companies from attributable open-web evidence.
          Discovery results are never treated as verified counterparties or executable quotes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            placeholder="Product, e.g. cocoa beans"
            className="xl:col-span-2"
          />
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as "supplier" | "buyer" | "logistics")}
          >
            <option value="supplier">Suppliers</option>
            <option value="buyer">Buyers</option>
            <option value="logistics">Logistics</option>
          </select>
          {role === "logistics" ? (
            <>
              <Input value={originCountry} onChange={(event) => setOriginCountry(event.target.value)} placeholder="Origin country" />
              <Input value={destinationCountry} onChange={(event) => setDestinationCountry(event.target.value)} placeholder="Destination country" />
            </>
          ) : (
            <Input
              value={countriesText}
              onChange={(event) => setCountriesText(event.target.value)}
              placeholder="Countries, comma-separated"
              className="xl:col-span-2"
            />
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={discover} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Discover candidates
          </Button>
        </div>

        {response?.candidates?.length ? (
          <div className="space-y-2">
            {response.candidates.map((candidate) => (
              <div key={candidate.discovery_id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{candidate.title || candidate.domain}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{candidate.domain}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge variant="outline">fit {candidate.discovery_fit_score}</Badge>
                    <Badge variant="secondary">discovery only</Badge>
                  </div>
                </div>
                {candidate.description ? (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{candidate.description}</p>
                ) : null}
                {candidate.contact_channels?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.contact_channels.map((contact) => (
                      <Badge key={contact.type + ":" + contact.value} variant="outline" className="text-[10px]">
                        {contact.value}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">No generic public business mailbox found in the discovered page content.</p>
                )}
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <ShieldAlert className="h-3 w-3" />
                  Verification still required before quote or transaction use.
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => window.dispatchEvent(new CustomEvent("aicis:screen-counterparty", {
                      detail: { legal_name: candidate.title || candidate.domain, role: candidate.role === "logistics" ? "logistics" : candidate.role === "buyer" ? "buyer" : "supplier" },
                    }))}
                  >
                    Screen official lists
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : response?.ok ? (
          <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
            No discovery candidates were returned for this search.
          </div>
        ) : null}

        {response?.discovery_notice ? (
          <p className="text-[10px] text-muted-foreground">{response.discovery_notice}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
