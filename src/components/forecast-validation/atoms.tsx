import { Card, CardContent } from "@/components/ui/card";

export interface SummaryStats {
  total: number; locked: number; pending: number;
  tp_total: number; tp_hits: number; tp_accuracy: number;
  avg_mae: number; direction_hit_rate: number;
  domain_count: number; country_count: number;
}
export interface DomainRow { domain: string; sample_size: number; tp_accuracy: number; mae: number; status: string; }
export interface HorizonRow { horizon: string; sample_size: number; accuracy: number; mae: number; }
export interface ModelRow { model_version: string; sample_size: number; tp_accuracy: number; mae: number; }
export interface HealthAlert { type: string; severity: string; message: string; value: number; }
export interface DomainPolicy { domain: string; match_window_days: number; direction_threshold_pct: number; preferred_period_type: string; is_active: boolean; notes: string; }

export const statusColor: Record<string, string> = {
  AWAITING_DATA: "bg-muted text-muted-foreground",
  INSUFFICIENT_SAMPLE: "bg-yellow-500/20 text-yellow-400",
  EMERGING: "bg-blue-500/20 text-blue-400",
  EVALUABLE: "bg-primary/20 text-primary",
  DECISION_GRADE: "bg-emerald-500/20 text-emerald-400",
};
export const accumStatusColor: Record<string, string> = {
  STALLED: "text-destructive", LOW_VOLUME: "text-yellow-400",
  HEALTHY: "text-blue-400", GROWING: "text-emerald-400",
};

export function SummaryCard({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string | number; valueClass?: string }) {
  return (
    <Card className="bg-card border-border"><CardContent className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
      <div className={`text-xl font-bold ${valueClass ?? "text-foreground"}`}>{value}</div>
    </CardContent></Card>
  );
}

export function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="bg-card border-border"><CardContent className="p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </CardContent></Card>
  );
}

export function MiniStat({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className={`rounded-md p-2 ${warn ? "bg-destructive/10" : "bg-muted/50"}`}>
      <div className={`text-lg font-bold ${warn ? "text-destructive" : "text-foreground"}`}>{value ?? 0}</div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
    </div>
  );
}
