import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Route, ShieldAlert } from "lucide-react";

type RouteVerificationResponse = {
  ok: boolean;
  verification_status?: string;
  transaction_eligible?: boolean;
  compliance_status?: string;
  rejection_reasons?: string[];
  normalized_route?: Record<string, unknown> | null;
  verification_scope_notice?: string;
  error?: string;
};

type RouteSeed = {
  dossier?: Record<string, unknown>;
};

const EMPTY_ROUTE_DOSSIER = {
  as_of: new Date().toISOString(),
  provider: {
    legal_name: "",
    jurisdiction: "",
    registration_id: "",
    evidence_refs: [],
  },
  compliance: {
    status: "review",
    screened_at: "",
    evidence_refs: [],
  },
  route_quote: {
    quote_id: "",
    route_name: "",
    origin_country: "",
    destination_country: "",
    transit_days: 0,
    valid_until: "",
    evidence_status: "verified_quote",
    evidence_refs: [],
    stops: [],
    costs: [
      {
        type: "freight",
        amount: 0,
        basis: "per_unit",
        currency: "",
        evidence_refs: [],
      },
    ],
  },
  capacity: {
    status: "verified",
    evidence_refs: [],
  },
  contact_channels: [],
  evidence_score: 0,
  capacity_score: 50,
};

export function LogisticsRouteVerificationLab() {
  const [payload, setPayload] = useState(JSON.stringify(EMPTY_ROUTE_DOSSIER, null, 2));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteVerificationResponse | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RouteSeed>).detail || {};
      if (detail.dossier) setPayload(JSON.stringify(detail.dossier, null, 2));
      setResult(null);
      window.requestAnimationFrame(() => {
        document.getElementById("logistics-route-verification")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    window.addEventListener("aicis:prepare-logistics-route", handler as EventListener);
    return () => window.removeEventListener("aicis:prepare-logistics-route", handler as EventListener);
  }, []);

  const verify = async () => {
    let dossier: unknown;
    try {
      dossier = JSON.parse(payload);
    } catch {
      toast({ title: "Invalid route dossier JSON", description: "Fix the JSON before verification.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("verify-logistics-route", {
      body: { dossier },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Route verification failed", description: error.message, variant: "destructive" });
      return;
    }

    const response = data as RouteVerificationResponse;
    setResult(response);
    if (!response.ok) {
      toast({
        title: "Route verification failed",
        description: response.error || "The logistics dossier could not be evaluated.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card id="logistics-route-verification">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Route className="h-4 w-4 text-primary" />
          Logistics Route Verification
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Verify a route quote before it can affect landed-cost economics. Provider identity/compliance, quote validity,
          transit time, capacity and every freight/handling/insurance cost require evidence.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-2">
          <Textarea value={payload} onChange={(event) => setPayload(event.target.value)} className="min-h-[420px] font-mono text-xs" />
          <div className="flex justify-end">
            <Button onClick={verify} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
              Verify route
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          {!result ? (
            <div className="min-h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground">
              <Route className="h-8 w-8 mb-3 opacity-50" />
              <p className="text-sm font-medium text-foreground">No route dossier evaluated yet</p>
              <p className="text-xs mt-1 max-w-sm">
                A discovered logistics company alone is insufficient; AICIS requires an attributable current route quote and capacity evidence.
              </p>
            </div>
          ) : result.transaction_eligible && result.normalized_route ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Verified route candidate</p>
              </div>
              <Badge>transaction-eligible route input</Badge>
              <pre className="max-h-[360px] overflow-auto rounded-md bg-muted/30 p-3 text-[10px] whitespace-pre-wrap">
                {JSON.stringify(result.normalized_route, null, 2)}
              </pre>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => window.dispatchEvent(new CustomEvent("aicis:add-verified-route", {
                    detail: { route: result.normalized_route },
                  }))}
                >
                  Add verified route to Transaction Lab
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">{result.verification_scope_notice}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Route verification incomplete</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{result.verification_status || "incomplete"}</Badge>
                {result.compliance_status ? <Badge variant="outline">compliance {result.compliance_status}</Badge> : null}
              </div>
              {result.rejection_reasons?.map((reason) => (
                <div key={reason} className="rounded-md bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground">
                  {reason}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">{result.verification_scope_notice}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
