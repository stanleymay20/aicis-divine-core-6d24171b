import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ShieldAlert, Activity, DollarSign } from "lucide-react";

export function BusinessExposureStrip() {
  const { data, isLoading } = useQuery({
    queryKey: ["business-exposure-strip"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [signalsRes, decisionsRes, riskRes] = await Promise.all([
        supabase
          .from("global_signals")
          .select("id, impact_score, category", { count: "exact" })
          .eq("enrichment_status", "enriched")
          .gte("impact_score", 60)
          .gte("first_detected_at", today),
        supabase
          .from("decision_outcome_log")
          .select("id", { count: "exact", head: true })
          .eq("action_taken", true)
          .is("outcome_success", null),
        supabase
          .from("vulnerability_scores")
          .select("overall_score")
          .gte("overall_score", 60)
          .limit(100),
      ]);

      const criticalSignals = signalsRes.data?.filter(s => s.impact_score >= 75).length || 0;
      const totalHighSignals = signalsRes.count || 0;
      const pendingDecisions = decisionsRes.count || 0;
      const marketsAtRisk = riskRes.data?.length || 0;

      // Estimate exposure from high-impact signals
      const totalExposure = (signalsRes.data || []).reduce((sum, s) => {
        const base = s.impact_score >= 80 ? 2_000_000 : s.impact_score >= 70 ? 500_000 : 200_000;
        return sum + base;
      }, 0);

      return { criticalSignals, totalHighSignals, pendingDecisions, marketsAtRisk, totalExposure };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data) return null;

  const fmt = (val: number) => {
    if (val >= 1_000_000) return `€${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `€${(val / 1_000).toFixed(0)}K`;
    return `€${val}`;
  };

  const items = [
    {
      icon: ShieldAlert,
      value: data.marketsAtRisk,
      label: "Markets at risk",
      color: data.marketsAtRisk > 5 ? "text-destructive" : "text-amber-500",
    },
    {
      icon: AlertTriangle,
      value: data.criticalSignals,
      label: "Critical disruptions",
      color: data.criticalSignals > 0 ? "text-destructive" : "text-emerald-500",
    },
    {
      icon: Activity,
      value: data.pendingDecisions,
      label: "Actions pending",
      color: data.pendingDecisions > 3 ? "text-amber-500" : "text-foreground",
    },
    {
      icon: DollarSign,
      value: data.totalExposure > 0 ? fmt(data.totalExposure) : "—",
      label: "Cost exposure",
      color: data.totalExposure > 1_000_000 ? "text-destructive" : "text-amber-500",
      isString: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label} className="border-border/50">
            <CardContent className="p-3 flex items-center gap-3">
              <Icon className={`h-5 w-5 ${item.color} shrink-0`} />
              <div>
                <p className={`text-lg font-bold ${item.color}`}>
                  {item.isString ? item.value : item.value}
                </p>
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
