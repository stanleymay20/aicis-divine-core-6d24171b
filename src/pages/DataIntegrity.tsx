import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { CheckCircle2, AlertTriangle, AlertOctagon, Activity, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";
import { TrainingFreshnessPanel } from "@/components/data-pipeline/TrainingFreshnessPanel";

interface IntegrityRow {
  check_name: string;
  value: number | null;
  total: number | null;
  pct: number | null;
  severity: "ok" | "warn" | "critical";
  measured_at: string;
}

const LABELS: Record<string, { title: string; subtitle: string; unit?: string }> = {
  event_link_completeness: { title: "Event → Entity Link Completeness", subtitle: "Share of normalized events joinable to the canonical entity graph", unit: "%" },
  metric_link_completeness: { title: "Metric → Entity Link Completeness", subtitle: "Share of normalized metrics joinable to the canonical entity graph", unit: "%" },
  iso3_cleanliness: { title: "ISO3 Cleanliness", subtitle: "Rows tagged with non-canonical country codes (lower is better)", unit: "rows" },
  country_coverage: { title: "Country Coverage", subtitle: "Canonical countries with a fresh (7-day) performance snapshot", unit: "%" },
  ingestion_metrics_per_hour: { title: "Live Metric Ingestion", subtitle: "Normalized metrics landed in the last hour", unit: "/h" },
  ingestion_events_per_hour: { title: "Live Event Ingestion", subtitle: "Normalized events landed in the last hour", unit: "/h" },
  snapshot_freshness_hours: { title: "Snapshot Freshness", subtitle: "Hours since the latest country performance snapshot", unit: "h stale" },
  entity_resolution_freshness_hours: { title: "Entity Resolution Freshness", subtitle: "Hours since the latest canonical-entity update", unit: "h stale" },
};

const SEVERITY_STYLE: Record<string, { bg: string; text: string; icon: typeof CheckCircle2; label: string }> = {
  ok: { bg: "bg-success/10 border-success/30", text: "text-success", icon: CheckCircle2, label: "OK" },
  warn: { bg: "bg-warning/10 border-warning/30", text: "text-warning", icon: AlertTriangle, label: "WARN" },
  critical: { bg: "bg-destructive/10 border-destructive/30", text: "text-destructive", icon: AlertOctagon, label: "CRITICAL" },
};

function formatValue(row: IntegrityRow): string {
  if (row.value === null) return "—";
  if (row.check_name.endsWith("_per_hour")) return row.value.toLocaleString();
  if (row.check_name.endsWith("_hours")) return `${row.value}h`;
  if (row.check_name === "iso3_cleanliness") return row.value.toLocaleString();
  if (row.total) return `${row.value.toLocaleString()} / ${row.total.toLocaleString()}`;
  return row.value.toLocaleString();
}

function IntegrityCard({ row }: { row: IntegrityRow }) {
  const meta = LABELS[row.check_name] ?? { title: row.check_name, subtitle: "" };
  const style = SEVERITY_STYLE[row.severity] ?? SEVERITY_STYLE.warn;
  const Icon = style.icon;
  const hasPct = row.pct !== null && (row.check_name.endsWith("_completeness") || row.check_name === "country_coverage");

  return (
    <Card className={cn("p-5 border", style.bg)}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold font-orbitron leading-tight">{meta.title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{meta.subtitle}</p>
        </div>
        <Badge variant="outline" className={cn("ml-3 flex items-center gap-1 shrink-0", style.text)}>
          <Icon className="h-3 w-3" /> {style.label}
        </Badge>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className={cn("text-3xl font-orbitron font-bold tabular-nums", style.text)}>{formatValue(row)}</span>
        {hasPct && row.pct !== null && (
          <span className="text-sm text-muted-foreground">({row.pct.toFixed(2)}%)</span>
        )}
      </div>
      {hasPct && row.pct !== null && <Progress value={row.pct} className="h-2" />}
    </Card>
  );
}

export default function DataIntegrity() {
  const { data, isLoading, error } = useQuery<IntegrityRow[]>({
    queryKey: ["data-integrity-snapshot"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_data_integrity_snapshot" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as IntegrityRow[];
    },
  });

  const okCount = data?.filter((r) => r.severity === "ok").length ?? 0;
  const warnCount = data?.filter((r) => r.severity === "warn").length ?? 0;
  const critCount = data?.filter((r) => r.severity === "critical").length ?? 0;
  const totalChecks = data?.length ?? 0;
  const trustScore = totalChecks > 0 ? Math.round(((okCount + warnCount * 0.5) / totalChecks) * 100) : 0;

  const order = [
    "event_link_completeness",
    "metric_link_completeness",
    "country_coverage",
    "iso3_cleanliness",
    "snapshot_freshness_hours",
    "entity_resolution_freshness_hours",
    "ingestion_metrics_per_hour",
    "ingestion_events_per_hour",
  ];
  const sorted = data
    ? [...data].sort((a, b) => order.indexOf(a.check_name) - order.indexOf(b.check_name))
    : [];

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-7xl">
      <SEO
        title="Data Integrity | AICIS Planetary Nervous System"
        description="Live G7-grade data integrity surface: entity-graph link completeness, country coverage, ingestion heartbeat, and freshness."
        path="/data-integrity"
      />

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl md:text-3xl font-orbitron font-bold">Data Integrity</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Zero-trust integrity surface. Every claim on this page is derived live from the database — no caches, no estimates.
          Refreshes every 30 seconds.
        </p>
      </header>

      <PanelBoundary>
        <Card className="p-6 border-primary/30">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-lg font-semibold font-orbitron">Nervous System Trust Score</h2>
                <p className="text-xs text-muted-foreground">
                  {okCount} OK · {warnCount} WARN · {critCount} CRITICAL across {totalChecks} live checks
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className={cn(
                "text-5xl font-orbitron font-bold tabular-nums",
                trustScore >= 80 ? "text-success" : trustScore >= 50 ? "text-warning" : "text-destructive",
              )}>
                {trustScore}%
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Integrity</p>
            </div>
          </div>
          <Progress value={trustScore} className="h-3 mt-4" />
        </Card>
      </PanelBoundary>

      <PanelBoundary>
        <TrainingFreshnessPanel />
      </PanelBoundary>


      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Measuring database…</Card>}
      {error && (
        <Card className="p-6 border-destructive/30">
          <p className="text-sm text-destructive">Could not load integrity snapshot. Sign in required.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sorted.map((row) => (
          <PanelBoundary key={row.check_name}>
            <IntegrityCard row={row} />
          </PanelBoundary>
        ))}
      </div>

      <Card className="p-4 border-muted/40 bg-muted/5">
        <p className="text-xs text-muted-foreground">
          <strong>Active remediation:</strong> Sweep #9 backfill engine runs every 5 minutes against orphan events and metrics.
          A 6-hour cron heals canonical country snapshot gaps. Dirty ISO3 codes are normalized via{" "}
          <code className="text-primary">f_normalize_iso3</code> at link time.
        </p>
      </Card>
    </div>
  );
}
