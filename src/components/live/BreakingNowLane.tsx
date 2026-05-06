/**
 * BreakingNowLane — canonical, high-urgency/high-impact signals from the
 * last 15 minutes. Default sort: urgency_score DESC, impact_score DESC,
 * detection_latency_seconds ASC.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type BreakingSignal = {
  id: string;
  title: string;
  translated_title: string | null;
  category: string | null;
  urgency_score: number | null;
  impact_score: number | null;
  confidence_score: number | null;
  affected_countries: string[] | null;
  first_detected_at: string;
  detection_latency_seconds: number | null;
  canonicalization_latency_seconds: number | null;
  source_trust_tier: string | null;
  corroboration_count: number | null;
};

const WINDOW_MIN = 15;

export function BreakingNowLane() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["breaking-now"],
    queryFn: async (): Promise<BreakingSignal[]> => {
      const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
      const { data, error } = await supabase
        .from("global_signals")
        .select("id,title,translated_title,category,urgency_score,impact_score,confidence_score,affected_countries,first_detected_at,detection_latency_seconds,canonicalization_latency_seconds,source_trust_tier,corroboration_count")
        .eq("canonical_event_status", "canonical")
        .gte("first_detected_at", since)
        .or("urgency_score.gte.70,impact_score.gte.70")
        .order("urgency_score", { ascending: false })
        .order("impact_score", { ascending: false })
        .order("detection_latency_seconds", { ascending: true, nullsFirst: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as BreakingSignal[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const items = data ?? [];

  return (
    <Card className="border-amber-700/40 bg-gradient-to-br from-amber-500/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-amber-400 animate-pulse" />
          Breaking now · last {WINDOW_MIN} min
        </CardTitle>
        <CardDescription>
          Canonical high-urgency/high-impact events. Sorted by urgency, impact, and detection latency.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-xs text-muted-foreground">Scanning…</p>}
        {!isLoading && items.length === 0 && (
          <p className="text-xs text-muted-foreground">No breaking signals in the last {WINDOW_MIN} minutes.</p>
        )}
        {items.map((s) => {
          const ageMin = Math.max(0, Math.round((now - new Date(s.first_detected_at).getTime()) / 60_000));
          const lat = s.detection_latency_seconds;
          const latLabel = lat == null
            ? null
            : lat < 60 ? `${lat}s wire→ingest`
            : `${Math.round(lat / 60)}m wire→ingest`;
          return (
            <div
              key={s.id}
              className="rounded-md border border-amber-800/30 bg-background/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold leading-snug">
                    {s.translated_title || s.title}
                  </h4>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    {s.category && <span className="text-foreground/70">{s.category}</span>}
                    {(s.affected_countries?.length ?? 0) > 0 && (
                      <span>· {s.affected_countries!.slice(0, 4).join(", ")}</span>
                    )}
                    {(s.corroboration_count ?? 0) > 1 && <span>· {s.corroboration_count} sources</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-1">
                    {typeof s.urgency_score === "number" && (
                      <Badge variant="outline" className="bg-rose-500/15 text-rose-300 border-rose-700/50 text-[10px] font-mono">
                        urg {s.urgency_score}
                      </Badge>
                    )}
                    {typeof s.impact_score === "number" && (
                      <Badge variant="outline" className="bg-amber-500/15 text-amber-300 border-amber-700/50 text-[10px] font-mono">
                        imp {s.impact_score}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                    <Clock className="h-3 w-3" />
                    {ageMin === 0 ? "just now" : `${ageMin}m ago`}
                    {latLabel && <span>· {latLabel}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default BreakingNowLane;
