import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldCheck, AlertCircle, Info, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type Tier = "decision-grade" | "review-needed" | "advisory";

const tierStyle: Record<Tier, { badge: string; icon: any; iconClass: string }> = {
  "decision-grade": {
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: ShieldCheck,
    iconClass: "text-emerald-400",
  },
  "review-needed": {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    icon: AlertCircle,
    iconClass: "text-amber-400",
  },
  advisory: {
    badge: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    icon: Info,
    iconClass: "text-sky-400",
  },
};

const layerLabel: Record<string, string> = {
  entity_links: "Entity Links",
  events: "Events",
  metrics: "Metrics",
  forecasts_measured: "Forecasts — Measured",
  forecasts_operational: "Forecasts — Operational",
};

export const LayerTrustTiersPanel = () => {
  const { data: tiers } = useQuery({
    queryKey: ["layer-trust-tiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_layer_trust_tiers" as any)
        .select("*")
        .order("display_order");
      if (error) throw error;
      return data as { layer: string; tier: Tier; rationale: string }[];
    },
    staleTime: 300_000,
  });

  const { data: split } = useQuery({
    queryKey: ["forecast-truth-split"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_forecast_truth_split" as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as {
        score_a_measured_accuracy: number;
        score_a_sample_size: number;
        score_a_untampered_validation_count: number;
        score_a_locked_prospective_count: number;
        score_b_operational_confidence: number;
        score_b_sample_size: number;
        score_b_mean_absolute_error: number;
        score_a_maturity: string;
        days_since_harness_freeze: number;
      };
    },
    staleTime: 300_000,
  });

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Truth Layer Tiers
            </CardTitle>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              Per-layer trust, honestly graded. Harness v1.0 frozen {split?.days_since_harness_freeze ?? "—"}d ago.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Dual forecast scores */}
        <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-muted/30 border border-border">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Score A · Measured</p>
                    <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                  </div>
                  <p className="text-lg sm:text-xl font-mono font-semibold mt-0.5">
                    {split?.score_a_measured_accuracy?.toFixed(1) ?? "—"}%
                  </p>
                  <p className="text-[9px] text-muted-foreground leading-tight">
                    {split?.score_a_untampered_validation_count?.toLocaleString() ?? 0} untampered ·{" "}
                    {split?.score_a_locked_prospective_count ?? 0} locked
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">
                  Scientific accuracy from records that have <strong>never been edited</strong> + locked prospective
                  evaluations. Tamper-evident.
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Score B · Operational</p>
                  <p className="text-lg sm:text-xl font-mono font-semibold mt-0.5">
                    {split?.score_b_operational_confidence?.toFixed(1) ?? "—"}%
                  </p>
                  <p className="text-[9px] text-muted-foreground leading-tight">
                    {split?.score_b_sample_size?.toLocaleString() ?? 0} rows · MAE{" "}
                    {split?.score_b_mean_absolute_error?.toFixed(2) ?? "—"}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">
                  Operational confidence using fairer-rubric harness v1.0. Useful for daily decisions; not yet
                  prospectively proven.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Maturity qualifier */}
        {split?.score_a_maturity === "pending_prospective_cycle" && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200 leading-snug">
              Measured forecast accuracy pending 30-day prospective cycle. External claims should reference Score A
              with this qualifier.
            </p>
          </div>
        )}

        {/* Layer tier list */}
        <div className="space-y-1.5">
          {tiers?.map((t) => {
            const style = tierStyle[t.tier];
            const Icon = style.icon;
            return (
              <TooltipProvider key={t.layer}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/60 hover:border-border transition-colors cursor-help">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", style.iconClass)} />
                        <span className="text-xs font-medium truncate">{layerLabel[t.layer] ?? t.layer}</span>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5 shrink-0", style.badge)}>
                        {t.tier}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">{t.rationale}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
