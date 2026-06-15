import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, Globe, ShieldCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

function Stat({
  icon: Icon, label, value, tone = "default",
}: { icon: any; label: string; value: string; tone?: "default" | "warn" | "danger" | "ok" }) {
  const toneCls = {
    default: "text-foreground",
    ok: "text-emerald-500",
    warn: "text-amber-500",
    danger: "text-red-500",
  }[tone];
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-r border-border/40 last:border-0 min-w-0">
      <Icon className={cn("h-4 w-4 shrink-0", toneCls)} />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground leading-none">{label}</div>
        <div className={cn("font-mono font-semibold text-sm leading-tight truncate", toneCls)}>{value}</div>
      </div>
    </div>
  );
}

export function OperationalRibbon() {
  const { data } = useQuery({
    queryKey: ["op-ribbon"],
    refetchInterval: 30_000,
    staleTime: 15_000,
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const [snap, signals, warnings, health] = await Promise.all([
        supabase.from("country_performance_snapshots").select("risk_pressure_score", { count: "exact", head: false }).eq("snapshot_date", today).gte("risk_pressure_score", 60),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).gte("ingested_at", new Date(Date.now() - 86400000).toISOString()),
        supabase.from("aicis_early_warnings").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("map_pipeline_health" as any).select("feed,status,hours_since"),
      ]);
      const stale = ((health.data as any[]) ?? []).filter((h) => h.status !== "healthy").length;
      return {
        highRisk: snap.count ?? 0,
        signals24h: signals.count ?? 0,
        activeWarnings: warnings.count ?? 0,
        feeds: ((health.data as any[]) ?? []).length,
        staleFeeds: stale,
      };
    },
  });

  return (
    <div className="flex items-center overflow-x-auto border-b border-border/60 bg-card/40 backdrop-blur">
      <Stat icon={Globe} label="High-risk markets" value={String(data?.highRisk ?? "—")} tone={data && data.highRisk > 30 ? "warn" : "default"} />
      <Stat icon={Activity} label="Signals 24h" value={(data?.signals24h ?? 0).toLocaleString()} />
      <Stat icon={AlertTriangle} label="Active warnings" value={String(data?.activeWarnings ?? "—")} tone={data && data.activeWarnings > 0 ? "danger" : "ok"} />
      <Stat icon={ShieldCheck} label="Feeds healthy" value={`${(data?.feeds ?? 0) - (data?.staleFeeds ?? 0)}/${data?.feeds ?? 0}`} tone={data?.staleFeeds ? "warn" : "ok"} />
      <Stat icon={Clock} label="Updated" value={new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} />
    </div>
  );
}
