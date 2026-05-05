/**
 * PlanetaryHeartbeat — slim, always-on global counter strip.
 * Shows: signals processed today · last signal time + country · pulse dot.
 * Polls every 20s, so it actually feels like a heartbeat.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Activity } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

type Row = {
  count_today: number;
  last_at: string | null;
  last_country: string | null;
  last_source: string | null;
};

export function PlanetaryHeartbeat() {
  const { data } = useQuery({
    queryKey: ["planetary-heartbeat"],
    queryFn: async (): Promise<Row> => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const [{ count }, { data: last }] = await Promise.all([
        supabase
          .from("global_signals")
          .select("id", { count: "exact", head: true })
          .gte("first_detected_at", since.toISOString()),
        supabase
          .from("global_signals")
          .select("first_detected_at, affected_countries, canonical_source_name")
          .order("first_detected_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        count_today: count ?? 0,
        last_at: last?.first_detected_at ?? null,
        last_country: last?.affected_countries?.[0] ?? null,
        last_source: last?.canonical_source_name ?? null,
      };
    },
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  const ago = data?.last_at
    ? formatDistanceToNowStrict(new Date(data.last_at), { addSuffix: false })
    : "—";

  return (
    <div className="flex items-center gap-3 text-[11px] font-mono">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-emerald-400 hidden sm:inline">
        <Activity className="h-3 w-3 inline mr-1" />
        {(data?.count_today ?? 0).toLocaleString()} signals today
      </span>
      <span className="text-muted-foreground hidden md:inline">
        · last {ago} ago{data?.last_country ? ` · ${data.last_country}` : ""}
      </span>
    </div>
  );
}
