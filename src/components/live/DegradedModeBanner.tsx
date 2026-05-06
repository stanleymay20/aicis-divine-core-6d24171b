/**
 * DegradedModeBanner — global header banner shown when any tier-1 firehose
 * has ≥3 consecutive failures. Auto-clears as soon as the next success
 * lands (firehose_health resets consecutive_failures to 0).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

type HealthRow = {
  firehose_name: string;
  trust_tier: string;
  consecutive_failures: number;
  last_error_message: string | null;
};

export function DegradedModeBanner() {
  const { data } = useQuery({
    queryKey: ["degraded-mode-banner"],
    queryFn: async (): Promise<HealthRow[]> => {
      const { data: rows } = await supabase
        .from("firehose_health" as any)
        .select("firehose_name,trust_tier,consecutive_failures,last_error_message")
        .eq("trust_tier", "tier_1")
        .gte("consecutive_failures", 3);
      return (rows ?? []) as unknown as HealthRow[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="w-full border-b border-destructive/40 bg-destructive/10 text-destructive text-[12px] px-3 py-2 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">Degraded mode:</span>{" "}
        <span className="text-foreground/80">
          {data.length} tier-1 source{data.length === 1 ? "" : "s"} offline —{" "}
          {data.map((d) => `${d.firehose_name} (${d.consecutive_failures} fails)`).join(", ")}.
          Coverage may be incomplete until upstream recovery.
        </span>
      </div>
    </div>
  );
}

export default DegradedModeBanner;
