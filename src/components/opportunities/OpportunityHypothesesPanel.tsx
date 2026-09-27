import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Lightbulb, Loader2, RefreshCw } from "lucide-react";

type Hypothesis = {
  hypothesis_id: string;
  source_signal_title: string;
  product: {
    id: string;
    name: string;
    unit: string;
    sectors: string[];
  };
  countries: string[];
  catalyst_type: string;
  matched_catalyst_terms: string[];
  relevance_score: number | null;
  relevance_tier: string | null;
  epistemic_status: string;
  profitability_status: string;
  guardrail: string;
};

type Response = {
  ok: boolean;
  hypotheses?: Hypothesis[];
  signals_scanned?: number;
  guardrail?: string;
  error?: string;
};

export function OpportunityHypothesesPanel() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const refresh = async () => {
    setLoading(true);
    const { data: response, error } = await supabase.functions.invoke("generate-opportunity-hypotheses", {
      body: { limit: 100 },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Hypothesis refresh failed", description: error.message, variant: "destructive" });
      return;
    }

    setData(response as Response);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              Personalized Opportunity Hypotheses
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              AICIS maps your relevant signals to products worth investigating. No price direction or profit is inferred at this stage.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Generate
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="rounded-md border border-dashed p-5 text-xs text-muted-foreground">
            Generate hypotheses from your current personalized signal scores.
          </div>
        ) : data.hypotheses?.length ? (
          <div className="space-y-2">
            {data.hypotheses.slice(0, 12).map((item) => (
              <div key={item.hypothesis_id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{item.product.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.source_signal_title}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {typeof item.relevance_score === "number" ? (
                      <Badge variant="outline">relevance {Math.round(item.relevance_score)}</Badge>
                    ) : null}
                    <Badge variant="secondary">research hypothesis</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.countries.slice(0, 5).map((country) => <Badge key={country} variant="outline" className="text-[10px]">{country}</Badge>)}
                  {item.matched_catalyst_terms.slice(0, 4).map((term) => <Badge key={term} variant="outline" className="text-[10px]">{term}</Badge>)}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Profitability unknown until current quotes, costs, counterparties and compliance are verified.
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-5 text-xs text-muted-foreground">
            No supported product hypotheses were found in the current relevant signals.
          </div>
        )}
        {data?.guardrail ? <p className="mt-3 text-[10px] text-muted-foreground">{data.guardrail}</p> : null}
      </CardContent>
    </Card>
  );
}
