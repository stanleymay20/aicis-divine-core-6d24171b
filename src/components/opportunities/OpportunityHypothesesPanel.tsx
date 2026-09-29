import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { BrainCircuit, Lightbulb, Loader2, RefreshCw } from "lucide-react";

type Hypothesis = {
  hypothesis_id: string;
  source_signal_id: string;
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
  evidence_priority_score: number;
  epistemic_status: string;
  profitability_status: string;
  guardrail: string;
};

type Response = {
  ok: boolean;
  hypotheses?: Hypothesis[];
  scan_scope?: "global" | "personalized";
  window_days?: number | null;
  raw_signals_scanned?: number;
  signals_scanned?: number;
  deduplicated_count?: number;
  scope_notice?: string;
  guardrail?: string;
  error?: string;
};

export function OpportunityHypothesesPanel() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { selectEntity } = useIntelligenceOS();

  const inspectHypothesis = (item: Hypothesis) => {
    selectEntity({
      id: item.hypothesis_id,
      type: "opportunity",
      name: item.product.name,
      description: `Research hypothesis derived from: ${item.source_signal_title}. Profitability remains unknown until attributable quotes, costs, counterparties, and compliance are verified.`,
      geography:
        item.countries.length === 1
          ? { country: item.countries[0] }
          : undefined,
      metadata: {
        epistemicStatus: item.epistemic_status,
        profitabilityStatus: item.profitability_status,
        relevanceScore: item.relevance_score,
        relevanceTier: item.relevance_tier,
        catalystType: item.catalyst_type,
        matchedCatalysts: item.matched_catalyst_terms.join(", ") || null,
        countries: item.countries.join(", ") || null,
        sectors: item.product.sectors.join(", ") || null,
        productUnit: item.product.unit,
        guardrail: item.guardrail,
      },
    });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: response, error } = await supabase.functions.invoke("generate-opportunity-hypotheses", {
      body: { limit: 900, scope: "global", window_days: 7 },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Hypothesis refresh failed", description: error.message, variant: "destructive" });
      return;
    }

    setData(response as Response);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              Opportunities AICIS found
              <Badge variant="outline" className="text-[9px]">world scan</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              AICIS scans your relevant world signals for situations worth investigating. These are discoveries, not profit claims; transaction economics remain unknown until verified.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Scan again
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Scanning current world signals for opportunities relevant to you…
          </div>
        ) : data.hypotheses?.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
              <span>{data.signals_scanned ?? 0} unique recent signals scanned</span>
              <span>·</span>
              <span>{data.hypotheses.length} supported opportunity hypotheses</span>
              {typeof data.deduplicated_count === "number" && data.deduplicated_count > 0 ? (
                <>
                  <span>·</span>
                  <span>{data.deduplicated_count} duplicate signals collapsed</span>
                </>
              ) : null}
              {data.window_days ? (
                <>
                  <span>·</span>
                  <span>{data.window_days}-day window</span>
                </>
              ) : null}
            </div>
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
                    <Badge variant="outline">evidence priority {Math.round(item.evidence_priority_score || 0)}</Badge>
                    <Badge variant="secondary">DISCOVERED</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.countries.slice(0, 5).map((country) => <Badge key={country} variant="outline" className="text-[10px]">{country}</Badge>)}
                  {item.matched_catalyst_terms.slice(0, 4).map((term) => <Badge key={term} variant="outline" className="text-[10px]">{term}</Badge>)}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Profitability unknown until current quotes, costs, counterparties and compliance are verified.
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => inspectHypothesis(item)}
                    aria-label={`Inspect opportunity ${item.product.name}`}
                  >
                    <BrainCircuit className="h-3.5 w-3.5 text-primary" />
                    Why this?
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("aicis:start-opportunity-investigation", {
                        detail: {
                          hypothesis_id: item.hypothesis_id,
                          source_signal_id: item.source_signal_id,
                          source_signal_title: item.source_signal_title,
                          product: item.product,
                          countries: item.countries,
                        },
                      }));
                      window.setTimeout(() => {
                        document.getElementById("opportunity-investigation")?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }, 50);
                    }}
                  >
                    Investigate transaction
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-5 text-xs text-muted-foreground">
            No supported product hypotheses were found in the current relevant signals.
          </div>
        )}
        {data?.scope_notice ? <p className="mt-3 text-[10px] text-muted-foreground">{data.scope_notice}</p> : null}
        {data?.guardrail ? <p className="mt-1 text-[10px] text-muted-foreground">{data.guardrail}</p> : null}
      </CardContent>
    </Card>
  );
}
