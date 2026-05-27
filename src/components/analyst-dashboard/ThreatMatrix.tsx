import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmpty } from "@/components/ui/panel-empty";

export function ThreatMatrix({ data }: { data: Record<string, Record<string, number>> | undefined }) {
  const rows = ["Critical", "High", "Elevated", "Medium", "Low"];
  const cols = ["Low", "Medium", "High", "Critical"];
  const cellColor = (sevIdx: number, likIdx: number, val: number) => {
    if (val === 0) return "bg-muted/20 text-muted-foreground/60";
    const intensity = Math.min(5, Math.floor((sevIdx + likIdx) / 1.4));
    const map = [
      "bg-emerald-500/10 text-emerald-200", "bg-emerald-500/25 text-emerald-100",
      "bg-amber-500/25 text-amber-100", "bg-amber-500/45 text-amber-50",
      "bg-rose-500/45 text-rose-50", "bg-rose-500/70 text-white",
    ];
    return map[intensity];
  };
  if (!data) return <Skeleton className="h-56 w-full" />;
  let totalCells = 0;
  for (const row of Object.values(data) as any[]) for (const v of Object.values(row)) totalCells += Number(v ?? 0);
  if (totalCells === 0) {
    return (
      <PanelEmpty
        title="No alerts to plot"
        reason="The matrix cross-tabulates open critical alerts by severity × likelihood. No unacknowledged alerts exist in the recent window."
        nextStep="Wait for the next ingestion cycle or check the Critical Alerts feed for routing failures."
        compact
      />
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[80px_repeat(4,1fr)_44px] gap-1 text-[10px] text-muted-foreground uppercase tracking-wider px-1">
        <div></div>{cols.map(c => <div key={c} className="text-center">{c}</div>)}<div className="text-right">Σ</div>
      </div>
      {rows.map((sev, si) => {
        const rowSum = cols.reduce((s, c) => s + (data[sev]?.[c] ?? 0), 0);
        return (
          <div key={sev} className="grid grid-cols-[80px_repeat(4,1fr)_44px] gap-1 items-center">
            <div className="text-xs text-muted-foreground">{sev}</div>
            {cols.map((c, li) => {
              const v = data[sev]?.[c] ?? 0;
              return (
                <div key={c} className={`h-9 rounded flex items-center justify-center text-sm tabular-nums font-medium ${cellColor(si, li, v)}`}>
                  {v}
                </div>
              );
            })}
            <div className="text-right text-xs tabular-nums text-muted-foreground">{rowSum}</div>
          </div>
        );
      })}
      <div className="text-[10px] text-center text-muted-foreground pt-1">Likelihood →</div>
    </div>
  );
}
