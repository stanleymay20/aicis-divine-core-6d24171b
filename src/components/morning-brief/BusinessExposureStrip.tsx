import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Globe2,
  ShieldAlert,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export function BusinessExposureStrip() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["business-exposure-strip"],
    queryFn: async () => {
      const startOfTodayUtc = new Date();
      startOfTodayUtc.setUTCHours(0, 0, 0, 0);

      const [signalsRes, decisionsRes, riskRes] = await Promise.all([
        supabase
          .from("global_signals")
          .select("id, impact_score", { count: "exact" })
          .eq("enrichment_status", "enriched")
          .gte("impact_score", 60)
          .gte("first_detected_at", startOfTodayUtc.toISOString()),
        supabase
          .from("decision_outcome_log")
          .select("id", { count: "exact", head: true })
          .eq("action_taken", true)
          .is("outcome_success", null),
        supabase
          .from("vulnerability_scores")
          .select("country, overall_score, calculated_at")
          .order("calculated_at", { ascending: false, nullsFirst: false })
          .limit(1000),
      ]);

      const queryError = signalsRes.error || decisionsRes.error || riskRes.error;
      if (queryError) throw queryError;

      const criticalSignals =
        signalsRes.data?.filter((signal) => signal.impact_score >= 75).length ?? 0;
      const totalHighSignals = signalsRes.count ?? 0;
      const pendingDecisions = decisionsRes.count ?? 0;

      const latestByCountry = new Map<string, number>();
      for (const score of riskRes.data ?? []) {
        if (!latestByCountry.has(score.country)) {
          latestByCountry.set(score.country, score.overall_score);
        }
      }

      const highVulnerabilityCountries = [...latestByCountry.values()].filter(
        (score) => score >= 60,
      ).length;

      return {
        criticalSignals,
        totalHighSignals,
        pendingDecisions,
        highVulnerabilityCountries,
      };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data) return null;

  const items = [
    {
      icon: Activity,
      value: data.totalHighSignals,
      label: "High-impact signals today",
      color: data.totalHighSignals > 0 ? "text-primary" : "text-emerald-500",
      to: "/live?minImpact=60",
    },
    {
      icon: AlertTriangle,
      value: data.criticalSignals,
      label: "Critical signals today",
      color: data.criticalSignals > 0 ? "text-destructive" : "text-emerald-500",
      to: "/live?severity=critical",
    },
    {
      icon: ShieldAlert,
      value: data.pendingDecisions,
      label: "Decisions awaiting outcome",
      color: data.pendingDecisions > 3 ? "text-amber-500" : "text-foreground",
      to: "/decision-ops",
    },
    {
      icon: Globe2,
      value: data.highVulnerabilityCountries,
      label: "Countries at ≥60 vulnerability",
      color:
        data.highVulnerabilityCountries > 5
          ? "text-amber-500"
          : "text-foreground",
      to: "/world?layer=vulnerability",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.to)}
            className="group rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={`${item.label} — drill into details`}
          >
            <Card className="border-border/50 transition-all group-hover:border-primary/40 group-hover:bg-primary/5">
              <CardContent className="relative flex items-center gap-3 p-3">
                <Icon className={`h-5 w-5 shrink-0 ${item.color}`} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-mono text-xl font-bold leading-none tabular-nums ${item.color}`}
                  >
                    {item.value}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                </div>
                <ArrowUpRight className="absolute right-2 top-2 h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
