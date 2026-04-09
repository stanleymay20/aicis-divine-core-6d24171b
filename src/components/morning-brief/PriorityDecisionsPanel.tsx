import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, AlertTriangle, ArrowRight, CheckCircle2, X,
  Globe, TrendingUp, Shield, Flame, Activity
} from "lucide-react";

const CROSS_DOMAIN_RULES: Array<{
  domains: string[];
  label: string;
  risk: string;
}> = [
  { domains: ["energy", "geopolitical"], label: "Supply Risk", risk: "Energy + geopolitics = supply disruption" },
  { domains: ["climate_disaster", "food", "public_health"], label: "Humanitarian Risk", risk: "Climate + food/health = shortage crisis" },
  { domains: ["financial_markets", "economic", "central_banking"], label: "Instability Risk", risk: "Markets + economy = systemic instability" },
  { domains: ["cybersecurity", "infrastructure", "technology"], label: "Infrastructure Risk", risk: "Cyber + infra = operational threat" },
  { domains: ["social_unrest", "elections", "geopolitical"], label: "Political Risk", risk: "Unrest + governance = regime instability" },
  { domains: ["defense_conflict", "energy", "supply_chain"], label: "Strategic Risk", risk: "Conflict + supply = strategic vulnerability" },
];

function detectCrossDomain(category: string, sectors: string[]): string[] {
  const all = [category, ...sectors].map(s => s?.toLowerCase() || "");
  const matched: string[] = [];
  for (const rule of CROSS_DOMAIN_RULES) {
    const hits = rule.domains.filter(d => all.some(a => a.includes(d)));
    if (hits.length >= 2) matched.push(rule.label);
  }
  return matched.length > 0 ? matched : sectors?.slice(0, 2) || [];
}

function urgencyFromScore(impact: number, urgency: number): "critical" | "high" | "medium" {
  const combined = impact * 0.6 + urgency * 0.4;
  if (combined >= 80) return "critical";
  if (combined >= 60) return "high";
  return "medium";
}

const URGENCY_STYLES = {
  critical: "border-destructive/40 bg-destructive/5",
  high: "border-orange-500/30 bg-orange-500/5",
  medium: "border-border",
};

const URGENCY_BADGE = {
  critical: "destructive" as const,
  high: "secondary" as const,
  medium: "outline" as const,
};

export function PriorityDecisionsPanel() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: priorities = [], isLoading } = useQuery({
    queryKey: ["priority-decisions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_signals")
        .select("id, title, summary, category, impact_score, urgency_score, confidence_score, affected_sectors, affected_regions, affected_countries, strategic_implications, recommended_actions, first_detected_at, source_trust_tier")
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 60)
        .order("impact_score", { ascending: false })
        .order("urgency_score", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []).map((s: any) => ({
        ...s,
        urgency: urgencyFromScore(s.impact_score, s.urgency_score),
        crossDomains: detectCrossDomain(s.category, s.affected_sectors || []),
        recommendedAction: s.recommended_actions?.government || s.recommended_actions?.business || s.strategic_implications || "Review and assess impact",
      }));
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const executeMutation = useMutation({
    mutationFn: async (signal: any) => {
      const { error } = await supabase
        .from("decision_outcome_log")
        .insert({
          signal_id: signal.id,
          signal_title: `[SIGNAL] ${signal.title}`,
          signal_date: new Date().toISOString().slice(0, 10),
          domain: signal.category,
          recommended_action: signal.recommendedAction,
          action_taken: true,
          impact_score: signal.impact_score,
          evidence_type: "hypothetical",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Decision created", description: "Moved to execution queue." });
      queryClient.invalidateQueries({ queryKey: ["morning-brief-decisions"] });
      queryClient.invalidateQueries({ queryKey: ["brief-value-summary"] });
    },
    onError: (e: any) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card className="border-primary/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Priority Decisions</span>
          </div>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (priorities.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">No urgent decisions required</p>
              <p className="text-xs text-muted-foreground">All high-impact signals have been addressed. Check Live Signals for new intelligence.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate("/live")} className="shrink-0 gap-1">
              Signals <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-destructive" />
          <h2 className="text-sm font-bold">Decisions You Must Make Today</h2>
          <Badge variant="destructive" className="text-[10px]">
            {priorities.filter(p => p.urgency === "critical").length} critical
          </Badge>
        </div>
        <Button size="sm" variant="ghost" className="text-xs gap-1 h-7 text-primary" onClick={() => navigate("/live")}>
          All signals <ArrowRight className="h-3 w-3" />
        </Button>
      </div>

      {priorities.map((p, i) => (
        <Card key={p.id} className={`${URGENCY_STYLES[p.urgency]} transition-colors hover:border-primary/40`}>
          <CardContent className="p-3 sm:p-4">
            <div className="space-y-2">
              {/* Header */}
              <div className="flex items-start gap-2">
                <span className="text-xs font-mono font-bold text-muted-foreground mt-0.5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold leading-snug line-clamp-2">{p.title}</h3>
                  {/* Why it matters */}
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                    {p.strategic_implications || p.summary}
                  </p>
                </div>
                <Badge variant={URGENCY_BADGE[p.urgency]} className="text-[10px] shrink-0 uppercase">
                  {p.urgency}
                </Badge>
              </div>

              {/* Cross-domain chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {p.crossDomains.map((d: string) => (
                  <Badge key={d} variant="outline" className="text-[9px] h-5 gap-1 border-primary/20">
                    <Globe className="h-2.5 w-2.5" />
                    {d}
                  </Badge>
                ))}
                {p.affected_regions?.slice(0, 2).map((r: string) => (
                  <Badge key={r} variant="secondary" className="text-[9px] h-5">
                    {r}
                  </Badge>
                ))}
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                  Impact {p.impact_score}
                </span>
              </div>

              {/* Recommended action */}
              <div className="bg-muted/50 rounded-md px-3 py-2 flex items-start gap-2">
                <Activity className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-xs font-medium leading-snug line-clamp-2">{p.recommendedAction}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5 flex-1 sm:flex-none"
                  onClick={() => executeMutation.mutate(p)}
                  disabled={executeMutation.isPending}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Execute Decision
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs gap-1 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
