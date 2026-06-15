import { useMemo } from "react";
import { Slider } from "@/components/ui/slider";

export function SimulationTimeline({
  value,
  onChange,
  maxDaysBack = 30,
}: {
  value: number; // days back from today; 0 = today
  onChange: (days: number) => void;
  maxDaysBack?: number;
}) {
  const label = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - value);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }, [value]);

  return (
    <div className="flex items-center gap-4 border-t border-border/60 bg-card/40 px-4 py-2 backdrop-blur">
      <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Timeline</div>
      <div className="flex-1">
        <Slider
          value={[maxDaysBack - value]}
          min={0}
          max={maxDaysBack}
          step={1}
          onValueChange={(v) => onChange(maxDaysBack - v[0])}
        />
      </div>
      <div className="font-mono text-xs font-semibold tabular-nums">{label}</div>
      <div className="font-mono text-[10px] text-muted-foreground">{value === 0 ? "live" : `T−${value}d`}</div>
    </div>
  );
}
