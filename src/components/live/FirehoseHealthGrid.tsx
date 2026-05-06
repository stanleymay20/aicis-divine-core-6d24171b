/**
 * FirehoseHealthGrid — per-source operational health cards.
 *
 * Surfaces every firehose tracked in firehose_health, including unconfigured
 * tier-2 sources (NewsAPI, Firecrawl) which display as "not configured".
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, CheckCircle2, AlertTriangle, Clock, PauseCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type HealthRow = {
  firehose_name: string;
  trust_tier: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_inserted_count: number | null;
  last_duration_ms: number | null;
  consecutive_failures: number;
  last_error_message: string | null;
  next_retry_at: string | null;
  backoff_seconds: number;
};

const KNOWN_FIREHOSES: { name: string; tier: "tier_1" | "tier_2" | "tier_3"; label: string }[] = [
  { name: "gdelt-firehose",      tier: "tier_3", label: "GDELT" },
  { name: "usgs-quake-firehose", tier: "tier_1", label: "USGS Quake" },
  { name: "reliefweb-firehose",  tier: "tier_1", label: "ReliefWeb (UN OCHA)" },
  { name: "newsapi-firehose",    tier: "tier_2", label: "NewsAPI" },
  { name: "firecrawl-firehose",  tier: "tier_2", label: "Firecrawl" },
];

function statusOf(h: HealthRow | null) {
  if (!h || (!h.last_success_at && !h.last_failure_at)) {
    return { label: "Not configured", tone: "muted" as const, Icon: PauseCircle };
  }
  if (h.last_error_message === "not_configured" && !h.last_success_at) {
    return { label: "Not configured", tone: "muted" as const, Icon: PauseCircle };
  }
  if (h.consecutive_failures >= 3) {
    return { label: "Offline", tone: "destructive" as const, Icon: AlertTriangle };
  }
  if (h.consecutive_failures > 0) {
    return { label: "Degraded", tone: "warning" as const, Icon: AlertTriangle };
  }
  return { label: "Healthy", tone: "success" as const, Icon: CheckCircle2 };
}

const toneClasses: Record<string, string> = {
  success:     "border-emerald-700/40 bg-emerald-500/5 text-emerald-300",
  warning:     "border-amber-700/40 bg-amber-500/5 text-amber-300",
  destructive: "border-destructive/40 bg-destructive/5 text-destructive",
  muted:       "border-border bg-muted/20 text-muted-foreground",
};

const tierLabels: Record<string, string> = {
  tier_1: "Tier 1 — Official",
  tier_2: "Tier 2 — Wire",
  tier_3: "Tier 3 — Web",
};

export function FirehoseHealthGrid() {
  const { data, isLoading } = useQuery({
    queryKey: ["firehose-health-grid"],
    queryFn: async (): Promise<HealthRow[]> => {
      const { data: rows } = await supabase
        .from("firehose_health" as any)
        .select("firehose_name,trust_tier,last_success_at,last_failure_at,last_inserted_count,last_duration_ms,consecutive_failures,last_error_message,next_retry_at,backoff_seconds");
      return (rows ?? []) as unknown as HealthRow[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const byName = new Map<string, HealthRow>();
  for (const r of data ?? []) byName.set(r.firehose_name, r);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4 text-violet-400" />
          Firehose Health
        </CardTitle>
        <CardDescription>
          Per-source ingestion status with auto-clear on next success and exponential backoff on failure.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {KNOWN_FIREHOSES.map((cfg) => {
          const h = byName.get(cfg.name) ?? null;
          const st = statusOf(h);
          const Icon = st.Icon;
          return (
            <div
              key={cfg.name}
              className={`rounded-md border p-2.5 ${toneClasses[st.tone]}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="text-sm font-semibold text-foreground">{cfg.label}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{cfg.name}</div>
                </div>
                <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                  <Icon className="h-3 w-3" />
                  {st.label}
                </Badge>
              </div>
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                <div className="flex justify-between">
                  <span>Tier</span>
                  <span className="text-foreground/70">{tierLabels[cfg.tier]}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last success</span>
                  <span className="text-foreground/70">
                    {h?.last_success_at ? formatDistanceToNow(new Date(h.last_success_at), { addSuffix: true }) : "never"}
                  </span>
                </div>
                {(h?.last_inserted_count ?? null) != null && (
                  <div className="flex justify-between">
                    <span>Last batch</span>
                    <span className="text-foreground/70 font-mono">
                      {h!.last_inserted_count} rows
                      {h?.last_duration_ms ? ` · ${(h.last_duration_ms / 1000).toFixed(1)}s` : ""}
                    </span>
                  </div>
                )}
                {h && h.consecutive_failures > 0 && (
                  <div className="flex justify-between">
                    <span>Failures</span>
                    <span className="text-destructive font-mono">{h.consecutive_failures} consecutive</span>
                  </div>
                )}
                {h?.next_retry_at && new Date(h.next_retry_at).getTime() > Date.now() && (
                  <div className="flex justify-between gap-1">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Backoff</span>
                    <span className="text-foreground/70">
                      retry {formatDistanceToNow(new Date(h.next_retry_at), { addSuffix: true })}
                    </span>
                  </div>
                )}
                {h?.last_error_message && h.last_error_message !== "not_configured" && (
                  <div className="text-[10px] font-mono text-destructive/80 line-clamp-2 pt-0.5" title={h.last_error_message}>
                    {h.last_error_message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default FirehoseHealthGrid;
