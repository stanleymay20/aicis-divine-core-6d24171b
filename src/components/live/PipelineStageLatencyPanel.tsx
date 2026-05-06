/**
 * PipelineStageLatencyPanel — median latency between consecutive pipeline stages,
 * computed from real global_signals timestamps over the last 24h.
 *
 * Stages tracked:
 *   ingest         = first_detected_at  → ingested_at
 *   canonicalization = ingested_at      → canonicalized_at
 *   language routing = canonicalized_at → language_routed_at
 *   country extraction = language_routed_at → country_extracted_at
 *   geocoding      = country_extracted_at → geocoded_at
 *   translation    = language_routed_at → translated_at  (selective)
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, ArrowRight } from "lucide-react";

type Row = {
  first_detected_at: string | null;
  ingested_at: string | null;
  canonicalized_at: string | null;
  language_routed_at: string | null;
  country_extracted_at: string | null;
  geocoded_at: string | null;
  translated_at: string | null;
};

type StageStat = { key: string; label: string; medianSec: number | null; p95Sec: number | null; sampleSize: number };

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function fmt(s: number | null): string {
  if (s == null) return "—";
  if (s < 1) return "<1s";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function diffSec(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  const d = (db - da) / 1000;
  if (d < 0 || d > 86400) return null; // ignore noise
  return d;
}

export function PipelineStageLatencyPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-stage-latency"],
    queryFn: async (): Promise<StageStat[]> => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: rows } = await supabase
        .from("global_signals")
        .select("first_detected_at,ingested_at,canonicalized_at,language_routed_at,country_extracted_at,geocoded_at,translated_at")
        .gte("ingested_at", since)
        .limit(5000);

      const stages: { key: string; label: string; from: keyof Row; to: keyof Row }[] = [
        { key: "ingest",        label: "Ingest",        from: "first_detected_at",   to: "ingested_at" },
        { key: "canon",         label: "Canonicalize",  from: "ingested_at",         to: "canonicalized_at" },
        { key: "lang",          label: "Language",      from: "canonicalized_at",    to: "language_routed_at" },
        { key: "country",       label: "Country",       from: "language_routed_at",  to: "country_extracted_at" },
        { key: "geo",           label: "Geocode",       from: "country_extracted_at",to: "geocoded_at" },
        { key: "translate",     label: "Translate",     from: "language_routed_at",  to: "translated_at" },
      ];

      return stages.map((st) => {
        const samples: number[] = [];
        for (const r of (rows ?? []) as Row[]) {
          const d = diffSec(r[st.from] as string | null, r[st.to] as string | null);
          if (d != null) samples.push(d);
        }
        samples.sort((a, b) => a - b);
        return {
          key: st.key,
          label: st.label,
          medianSec: quantile(samples, 0.5),
          p95Sec: quantile(samples, 0.95),
          sampleSize: samples.length,
        };
      });
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-sky-400" />
          Per-Stage Latency
        </CardTitle>
        <CardDescription>
          Median time between consecutive pipeline stages over the last 24 hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-1.5">
            {data.map((st, i) => (
              <div
                key={st.key}
                className="flex items-center justify-between gap-2 rounded border border-border/50 bg-muted/10 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
                  <span className="font-medium text-foreground/90">{st.label}</span>
                  <span className="text-muted-foreground">· n={st.sampleSize}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-muted-foreground shrink-0">
                  <span title="median">p50 <span className="text-foreground">{fmt(st.medianSec)}</span></span>
                  <span title="95th percentile">p95 <span className="text-foreground/80">{fmt(st.p95Sec)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PipelineStageLatencyPanel;
