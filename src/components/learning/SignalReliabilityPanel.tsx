import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

export const SignalReliabilityPanel = () => {
  // Get signal category + trust tier stats
  const { data: signalStats, isLoading } = useQuery({
    queryKey: ["learning-signal-reliability"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_signals")
        .select("category, source_trust_tier, impact_score, confidence_score, status")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!data) return [];

      // Aggregate by category
      const catMap: Record<string, { total: number; avgImpact: number; avgConf: number; tiers: Record<string, number> }> = {};
      for (const s of data) {
        const cat = s.category || "unknown";
        if (!catMap[cat]) catMap[cat] = { total: 0, avgImpact: 0, avgConf: 0, tiers: {} };
        catMap[cat].total += 1;
        catMap[cat].avgImpact += s.impact_score || 0;
        catMap[cat].avgConf += s.confidence_score || 0;
        const tier = s.source_trust_tier || "unrated";
        catMap[cat].tiers[tier] = (catMap[cat].tiers[tier] || 0) + 1;
      }

      return Object.entries(catMap)
        .map(([cat, v]) => ({
          category: cat,
          total: v.total,
          avgImpact: v.total > 0 ? v.avgImpact / v.total : 0,
          avgConf: v.total > 0 ? v.avgConf / v.total : 0,
          tier1Pct: ((v.tiers["tier_1"] || 0) + (v.tiers["tier_2"] || 0)) / v.total * 100,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          Signal Reliability by Category
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : signalStats?.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No signal data available</p>
        ) : (
          <div className="space-y-2">
            {signalStats?.map((s) => (
              <div key={s.category} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/30 last:border-0">
                <div className="min-w-0">
                  <p className="text-xs font-medium capitalize truncate">{s.category.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-muted-foreground">{s.total} signals</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Avg Impact</p>
                    <p className={`text-xs font-bold ${s.avgImpact >= 70 ? "text-red-500" : s.avgImpact >= 50 ? "text-amber-500" : "text-emerald-500"}`}>
                      {s.avgImpact.toFixed(0)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Tier 1-2</p>
                    <p className={`text-xs font-bold ${s.tier1Pct >= 30 ? "text-emerald-500" : "text-amber-500"}`}>
                      {s.tier1Pct.toFixed(0)}%
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
