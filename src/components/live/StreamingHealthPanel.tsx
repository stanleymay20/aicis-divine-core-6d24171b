/**
 * StreamingHealthPanel — Live nervous-system telemetry.
 * - signals processed today
 * - median + p95 detection latency
 * - pending canonicalization / language routing / geocoding
 * - last successful run per firehose
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, Heart, Timer, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Stats = {
  signalsToday: number;
  medianDetectionSec: number | null;
  p95DetectionSec: number | null;
  pendingCanon: number;
  pendingLangRoute: number;
  pendingGeo: number;
  firehoseRuns: { job: string; at: string }[];
};

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function fmtSec(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export function StreamingHealthPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["streaming-health"],
    queryFn: async (): Promise<Stats> => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();

      const [todayRes, latencyRes, pendCanonRes, pendLangRes, pendGeoRes, runsRes] = await Promise.all([
        supabase.from("global_signals").select("id", { count: "exact", head: true }).gte("ingested_at", since),
        supabase.from("global_signals")
          .select("detection_latency_seconds")
          .gte("ingested_at", since)
          .not("detection_latency_seconds", "is", null)
          .limit(5000),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).is("canonical_event_status", null),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).is("language_routed_at", null),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).is("geocoded_at", null),
        supabase.from("automation_logs")
          .select("job_name,executed_at")
          .in("job_name", ["gdelt-firehose", "reliefweb-firehose", "usgs-quake-firehose"])
          .eq("status", "success")
          .order("executed_at", { ascending: false })
          .limit(60),
      ]);

      const lats = ((latencyRes.data ?? []) as { detection_latency_seconds: number }[])
        .map((r) => r.detection_latency_seconds)
        .filter((n) => typeof n === "number" && n >= 0)
        .sort((a, b) => a - b);

      const seenJobs = new Map<string, string>();
      for (const r of (runsRes.data ?? []) as { job_name: string; executed_at: string }[]) {
        if (!seenJobs.has(r.job_name)) seenJobs.set(r.job_name, r.executed_at);
      }

      return {
        signalsToday: todayRes.count ?? 0,
        medianDetectionSec: quantile(lats, 0.5),
        p95DetectionSec: quantile(lats, 0.95),
        pendingCanon: pendCanonRes.count ?? 0,
        pendingLangRoute: pendLangRes.count ?? 0,
        pendingGeo: pendGeoRes.count ?? 0,
        firehoseRuns: Array.from(seenJobs.entries()).map(([job, at]) => ({ job, at })),
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Heart className="h-4 w-4 text-emerald-400 animate-pulse" />
          Live Nervous System
        </CardTitle>
        <CardDescription>
          End-to-end pipeline telemetry over the last 24 hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || !data ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Stat icon={<Activity className="h-3.5 w-3.5" />} label="Signals (24h)" value={data.signalsToday.toLocaleString()} />
              <Stat icon={<Timer className="h-3.5 w-3.5" />} label="Median detect" value={fmtSec(data.medianDetectionSec)} />
              <Stat icon={<Timer className="h-3.5 w-3.5" />} label="p95 detect" value={fmtSec(data.p95DetectionSec)} />
              <Stat icon={<AlertCircle className="h-3.5 w-3.5" />} label="Pending canon" value={data.pendingCanon.toLocaleString()} />
              <Stat icon={<AlertCircle className="h-3.5 w-3.5" />} label="Pending lang" value={data.pendingLangRoute.toLocaleString()} />
              <Stat icon={<AlertCircle className="h-3.5 w-3.5" />} label="Pending geo" value={data.pendingGeo.toLocaleString()} />
            </div>
            <div className="border-t border-border/50 pt-2">
              <div className="text-[11px] text-muted-foreground mb-1">Last successful firehose runs</div>
              <div className="space-y-1">
                {data.firehoseRuns.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">No recent runs.</div>
                )}
                {data.firehoseRuns.map((r) => (
                  <div key={r.job} className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-foreground/80">{r.job}</span>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(r.at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/10 p-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-mono font-semibold mt-0.5">{value}</div>
    </div>
  );
}

export default StreamingHealthPanel;
