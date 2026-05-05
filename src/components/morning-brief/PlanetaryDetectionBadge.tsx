import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Globe2, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type AuditRow = {
  detection_rate: number;
  trending_events_checked: number;
  events_detected: number;
  events_missed: number;
  avg_latency_minutes: number | null;
  run_at: string;
};

export const PlanetaryDetectionBadge = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["planetary-detection-sla"],
    queryFn: async (): Promise<AuditRow | null> => {
      const { data } = await supabase
        .from("detection_audit_runs")
        .select("detection_rate, trending_events_checked, events_detected, events_missed, avg_latency_minutes, run_at")
        .order("run_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as AuditRow | null;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isLoading || !data) return null;

  const rate = Number(data.detection_rate || 0);
  const isPerfect = rate >= 99.5;
  const isStrong = rate >= 80;
  const tone = isPerfect
    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
    : isStrong
    ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
    : "bg-amber-500/10 border-amber-500/30 text-amber-300";
  const Icon = isPerfect ? CheckCircle2 : isStrong ? Globe2 : AlertTriangle;

  return (
    <Card className={`border ${tone} px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-3`}>
      <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full bg-background/40">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-lg sm:text-xl font-semibold leading-none">
            {rate.toFixed(1)}%
          </span>
          <span className="text-[11px] sm:text-xs uppercase tracking-wide opacity-90">
            Planetary Detection
          </span>
        </div>
        <p className="text-[10px] sm:text-[11px] mt-0.5 text-muted-foreground truncate">
          {data.events_detected}/{data.trending_events_checked} trending world events caught ·
          {" "}{formatDistanceToNow(new Date(data.run_at), { addSuffix: true })}
        </p>
      </div>
    </Card>
  );
};
