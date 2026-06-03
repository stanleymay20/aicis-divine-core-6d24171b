import { cn } from "@/lib/utils";
import { confidenceLabel } from "@/lib/humanize-vocab";

/**
 * Replaces raw "Confidence = 0.84" with executive-grade tier label + percentage.
 */
export const ConfidenceBadge = ({ value, label }: { value: number; label?: string }) => {
  const tier = confidenceLabel(value);
  const pct = Math.round(value * 100);
  const tone =
    tier === "HIGH" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : tier === "MEDIUM" ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400";
  return (
    <div className={cn("inline-flex flex-col items-start gap-0.5 rounded border px-2 py-1 font-mono", tone)}>
      <span className="text-[9px] uppercase tracking-widest opacity-80">{label ?? "Assessment Confidence"}</span>
      <span className="text-xs font-semibold leading-none">{tier} · {pct}%</span>
    </div>
  );
};
