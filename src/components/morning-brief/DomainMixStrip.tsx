import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  Globe2, TrendingUp, HeartPulse, CloudLightning, Shield,
  Truck, Vote, Users, Zap, Wheat, Droplets, MoveRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// 12-domain "planetary baseline"
const DOMAINS: { key: string; label: string; icon: any; match: RegExp }[] = [
  { key: "geopolitical", label: "Geo", icon: Globe2, match: /geopolit|diplomat|sanction|conflict|military/i },
  { key: "economic", label: "Econ", icon: TrendingUp, match: /econ|market|currency|inflation|trade|financ/i },
  { key: "health", label: "Health", icon: HeartPulse, match: /health|disease|outbreak|pandemic/i },
  { key: "climate", label: "Climate", icon: CloudLightning, match: /climate|disaster|earthquake|storm|wildfire|flood/i },
  { key: "cyber", label: "Cyber", icon: Shield, match: /cyber|security|vulnerab|breach/i },
  { key: "supply_chain", label: "Supply", icon: Truck, match: /supply|logistic|shipping|chokepoint/i },
  { key: "political", label: "Politics", icon: Vote, match: /political|election|protest|govern/i },
  { key: "humanitarian", label: "Human", icon: Users, match: /humanit|displac|refugee|crisis/i },
  { key: "energy", label: "Energy", icon: Zap, match: /energy|oil|gas|mineral|power/i },
  { key: "food", label: "Food", icon: Wheat, match: /food|agricultur|crop|famine|fertilizer/i },
  { key: "water", label: "Water", icon: Droplets, match: /water|drought|hydro|aquifer/i },
  { key: "migration", label: "Migration", icon: MoveRight, match: /migrat|border|asylum/i },
];

export const DomainMixStrip = () => {
  const { data: counts } = useQuery({
    queryKey: ["domain-mix-24h"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("global_signals")
        .select("category, summary, title")
        .gte("first_detected_at", since)
        .limit(500);

      const tally: Record<string, number> = Object.fromEntries(DOMAINS.map((d) => [d.key, 0]));
      (data || []).forEach((s: any) => {
        const blob = `${s.category || ""} ${s.title || ""} ${s.summary || ""}`;
        for (const d of DOMAINS) {
          if (d.match.test(blob)) {
            tally[d.key] += 1;
            break;
          }
        }
      });
      return tally;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <Card className="border-border p-2.5 sm:p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Domain coverage · last 24h
        </p>
        <p className="text-[10px] sm:text-xs text-muted-foreground">
          {total} signals · 12 domains
        </p>
      </div>
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
        {DOMAINS.map((d) => {
          const n = counts?.[d.key] ?? 0;
          const active = n > 0;
          const Icon = d.icon;
          return (
            <div
              key={d.key}
              className={cn(
                "flex flex-col items-center gap-0.5 p-1.5 rounded-md border transition-colors",
                active
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/50 bg-muted/20 opacity-60"
              )}
              title={`${d.label}: ${n} signal${n === 1 ? "" : "s"} in 24h`}
            >
              <Icon className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", active ? "text-primary" : "text-muted-foreground")} />
              <span className="text-[9px] sm:text-[10px] font-medium leading-none">{d.label}</span>
              <span className={cn("text-[9px] sm:text-[10px] font-mono leading-none", active ? "text-primary" : "text-muted-foreground")}>
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
