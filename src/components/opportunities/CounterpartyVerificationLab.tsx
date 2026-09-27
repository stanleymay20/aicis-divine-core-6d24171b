import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, FileCheck2, Loader2, ShieldAlert } from "lucide-react";

type VerificationResponse = {
  ok: boolean;
  verification_status?: string;
  transaction_eligible?: boolean;
  rejection_reasons?: string[];
  compliance_status?: string;
  normalized_offer?: Record<string, unknown> | null;
  verification_scope_notice?: string;
  error?: string;
};

type VerificationSeed = {
  dossier?: Record<string, unknown>;
};

const EMPTY_DOSSIER = {
  as_of: new Date().toISOString(),
  role: "supplier",
  legal_identity: {
    legal_name: "",
    jurisdiction: "",
    registration_id: "",
    evidence_refs: [],
  },
  official_site: {
    domain: "",
    url: "",
    evidence_refs: [],
  },
  compliance: {
    status: "review",
    screened_at: "",
    evidence_refs: [],
  },
  commercial_quote: {
    quote_id: "",
    product_id: "",
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
  contact_channels: [],
  evidence_score: 0,
  counterparty_quality_score: 50,
};

export function CounterpartyVerificationLab() {
  const [payload, setPayload] = useState(JSON.stringify(EMPTY_DOSSIER, null, 2));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResponse | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<VerificationSeed>).detail || {};
      if (detail.dossier) setPayload(JSON.stringify(detail.dossier, null, 2));
      setResult(null);
      window.requestAnimationFrame(() => {
        document.getElementById("counterparty-verification")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    window.addEventListener("aicis:verify-counterparty", handler as EventListener);
    return () => window.removeEventListener("aicis:verify-counterparty", handler as EventListener);
  }, []);

  const verify = async () => {
    let dossier: unknown;
    try {
      dossier = JSON.parse(payload);
    } catch {
      toast({ title: "Invalid dossier JSON", description: "Fix the JSON before verification.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("verify-transaction-counterparty", {
      body: { dossier },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Counterparty verification failed", description: error.message, variant: "destructive" });
      return;
    }

    const response = data as VerificationResponse;
    setResult(response);
    if (!response.ok) {
      toast({
        title: "Counterparty verification failed",
        description: response.error || "The dossier could not be evaluated.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card id="counterparty-verification">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" />
          Counterparty Verification Lab
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Complete the evidence dossier required to turn a discovered company into a normalized supplier or buyer offer.
          Official-list screening enters as review evidence; only an explicit clear compliance outcome can pass the gate.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-2">
          <Textarea
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            className="min-h-[420px] font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button onClick={verify} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
              Verify dossier
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          {!result ? (
            <div className="min-h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground">
              <FileCheck2 className="h-8 w-8 mb-3 opacity-50" />
              <p className="text-sm font-medium text-foreground">No dossier evaluated yet</p>
              <p className="text-xs mt-1 max-w-sm">
                Legal identity, official-site evidence, compliance, current quote, capacity and payment terms must all be evidenced.
              </p>
            </div>
          ) : result.transaction_eligible && result.normalized_offer ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Verified for transaction candidate</p>
              </div>
              <Badge>transaction-eligible input</Badge>
              <pre className="max-h-[360px] overflow-auto rounded-md bg-muted/30 p-3 text-[10px] whitespace-pre-wrap">
                {JSON.stringify(result.normalized_offer, null, 2)}
              </pre>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    const role = result.normalized_offer?.role;
                    if (role !== "supplier" && role !== "buyer") {
                      toast({
                        title: "Offer role missing",
                        description: "The normalized offer must identify itself as supplier or buyer.",
                        variant: "destructive",
                      });
                      return;
                    }
                    window.dispatchEvent(new CustomEvent("aicis:add-verified-offer", {
                      detail: { role, offer: result.normalized_offer },
                    }));
                  }}
                >
                  Add verified {String(result.normalized_offer.role || "counterparty")} to Transaction Lab
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">{result.verification_scope_notice}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Verification incomplete</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{result.verification_status || "incomplete"}</Badge>
                {result.compliance_status ? <Badge variant="outline">compliance {result.compliance_status}</Badge> : null}
              </div>
              {result.rejection_reasons?.length ? (
                <div className="space-y-1">
                  {result.rejection_reasons.map((reason) => (
                    <div key={reason} className="rounded-md bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground">
                      {reason}
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="text-[10px] text-muted-foreground">{result.verification_scope_notice}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
