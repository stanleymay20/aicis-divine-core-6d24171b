import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Zap, Globe, Map, MapPin, ArrowDown, AlertTriangle, Activity, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState } from "react";

interface PropagationLayer {
  level: "global" | "country" | "region" | "village";
  label: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
}

function buildPropagationChain(signal: any): PropagationLayer[] {
  const layers: PropagationLayer[] = [];
  const cat = signal.category?.toLowerCase() || "";
  const impact = signal.impact_score || 0;

  // Global trigger
  layers.push({
    level: "global",
    label: signal.title,
    detail: signal.summary || "Global intelligence signal detected",
    severity: impact >= 80 ? "critical" : impact >= 60 ? "high" : "medium",
  });

  // Country exposure
  const countries = signal.affected_countries || [];
  if (countries.length > 0) {
    layers.push({
      level: "country",
      label: `${countries.length} ${countries.length === 1 ? "country" : "countries"} exposed`,
      detail: countries.slice(0, 5).join(", ") + (countries.length > 5 ? ` +${countries.length - 5} more` : ""),
      severity: impact >= 70 ? "high" : "medium",
    });
  }

  // Regional concentration
  const regions = signal.affected_regions || [];
  if (regions.length > 0) {
    layers.push({
      level: "region",
      label: `Regional concentration in ${regions.length} ${regions.length === 1 ? "area" : "areas"}`,
      detail: regions.slice(0, 4).join(", "),
      severity: impact >= 75 ? "high" : "medium",
    });
  }

  // Village-level inference
  const villageInference = inferVillageImpact(cat, impact);
  if (villageInference) {
    layers.push({
      level: "village",
      label: villageInference.label,
      detail: villageInference.detail,
      severity: villageInference.severity,
    });
  }

  return layers;
}

function inferVillageImpact(category: string, impact: number): PropagationLayer | null {
  const mappings: Record<string, { label: string; detail: string }> = {
    food: { label: "Village food security stress", detail: "Crop yield and food price indicators likely affected at local level within 2–4 weeks" },
    climate: { label: "Village climate exposure", detail: "Satellite-detected drought/flood stress propagating to settlement-level agriculture" },
    energy: { label: "Local energy access disruption", detail: "Power grid and fuel supply indicators suggest village-level energy poverty risk" },
    health: { label: "Community health pressure", detail: "Disease surveillance and health facility data indicate rising local health burden" },
    conflict: { label: "Local displacement risk", detail: "Conflict proximity indicators suggest population movement at village level" },
    economic: { label: "Local livelihood stress", detail: "Market price anomalies and employment indicators showing village-level strain" },
    financial: { label: "Local credit contraction", detail: "Financial stress may restrict micro-lending and informal credit at village level" },
    infrastructure: { label: "Local infrastructure degradation", detail: "Road network and connectivity indicators showing reduced local access" },
  };

  for (const [key, val] of Object.entries(mappings)) {
    if (category.includes(key)) {
      return {
        level: "village",
        ...val,
        severity: impact >= 80 ? "critical" : impact >= 65 ? "high" : "medium",
      };
    }
  }

  if (impact >= 70) {
    return {
      level: "village",
      label: "Potential village-level stress",
      detail: "High-impact signals often cascade to local indicators within 4–6 weeks",
      severity: "medium",
    };
  }

  return null;
}

const LEVEL_CONFIG = {
  global: { icon: Globe, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  country: { icon: Map, color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/30" },
  region: { icon: MapPin, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  village: { icon: Activity, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
};

const SEVERITY_COLORS = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

export function DecisionPropagationPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: signals = [], isLoading } = useQuery({
    queryKey: ["decision-propagation-signals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_signals")
        .select("id, title, summary, category, impact_score, urgency_score, affected_sectors, affected_regions, affected_countries, strategic_implications")
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 65)
        .order("impact_score", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []).map((s: any) => ({
        ...s,
        chain: buildPropagationChain(s),
      }));
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Decision Propagation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (signals.length === 0) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Decision Propagation — Causal Chain Analysis
          <Badge variant="secondary" className="text-[10px] ml-auto">{signals.length} active</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {signals.map((signal: any) => {
          const isExpanded = expandedId === signal.id;
          return (
            <div key={signal.id} className="rounded-lg border border-border/50 overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : signal.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
              >
                <AlertTriangle className={`h-4 w-4 shrink-0 ${signal.impact_score >= 80 ? "text-destructive" : "text-amber-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-1">{signal.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">Impact {signal.impact_score}</span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground">{signal.chain.length} layers</span>
                  </div>
                </div>
                {/* Mini propagation dots */}
                <div className="flex items-center gap-1 shrink-0">
                  {signal.chain.map((layer: PropagationLayer, i: number) => {
                    const cfg = LEVEL_CONFIG[layer.level];
                    return (
                      <div key={i} className={`w-2.5 h-2.5 rounded-full ${cfg.bg} border ${cfg.border}`} title={layer.level} />
                    );
                  })}
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1">
                  <div className="relative pl-5">
                    {/* Vertical line */}
                    <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />

                    {signal.chain.map((layer: PropagationLayer, i: number) => {
                      const cfg = LEVEL_CONFIG[layer.level];
                      const Icon = cfg.icon;
                      return (
                        <div key={i} className="relative mb-3 last:mb-0">
                          {/* Dot on line */}
                          <div className={`absolute -left-5 top-1 w-[18px] h-[18px] rounded-full ${cfg.bg} border ${cfg.border} flex items-center justify-center`}>
                            <Icon className={`h-2.5 w-2.5 ${cfg.color}`} />
                          </div>

                          <div className={`ml-1 rounded-md border p-2.5 ${SEVERITY_COLORS[layer.severity]}`}>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[9px] h-4 ${cfg.border} ${cfg.color}`}>
                                {layer.level}
                              </Badge>
                              <p className="text-xs font-semibold line-clamp-1">{layer.label}</p>
                            </div>
                            <p className="text-[11px] mt-1 opacity-80 leading-relaxed">{layer.detail}</p>
                          </div>

                          {i < signal.chain.length - 1 && (
                            <div className="flex justify-center -my-1 relative z-10">
                              <ArrowDown className="h-3 w-3 text-muted-foreground/50" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
