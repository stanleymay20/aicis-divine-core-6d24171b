import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Clock, MapPin } from "lucide-react";

export function EventRail({
  selectedIso3,
  onSelect,
}: {
  selectedIso3?: string | null;
  onSelect: (iso3: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["event-rail", selectedIso3],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("global_signals")
        .select("id,title,affected_countries,impact_score,ingested_at,canonical_source_name,category")
        .order("ingested_at", { ascending: false })
        .limit(30);
      if (selectedIso3) q = q.contains("affected_countries", [selectedIso3]);
      const { data } = await q;
      return data ?? [];
    },
  });

  return (
    <aside className="flex h-full w-full flex-col border-l border-border/60 bg-card/30">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Live events {selectedIso3 ? `· ${selectedIso3}` : ""}
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">{data?.length ?? 0}</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : !data?.length ? (
          <div className="p-6 text-center text-[11px] text-muted-foreground">
            No recent events {selectedIso3 ? `for ${selectedIso3}` : ""}.
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {data.map((s: any) => {
              const tone = (s.impact_score ?? 0) >= 70 ? "border-l-red-500" : (s.impact_score ?? 0) >= 50 ? "border-l-amber-500" : "border-l-muted";
              return (
                <li key={s.id}>
                  <button
                    onClick={() => s.affected_countries?.[0] && onSelect(s.affected_countries[0])}
                    className={cn("group w-full border-l-2 px-3 py-2 text-left hover:bg-muted/30", tone)}
                  >
                    <div className="line-clamp-2 text-[12px] font-medium leading-tight">{s.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{new Date(s.ingested_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                      {s.affected_countries?.length > 0 && (
                        <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{s.affected_countries.slice(0, 2).join(", ")}</span>
                      )}
                      <span className="ml-auto font-mono">{Math.round(s.impact_score ?? 0)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
