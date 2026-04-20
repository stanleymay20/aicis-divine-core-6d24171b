/**
 * Humanize raw numeric scores into plain English for non-technical users.
 * All inputs are normalized to 0-100 (or 0-1 — auto-detected).
 */

const norm = (n: number) => (n <= 1 ? n * 100 : n);

/** Severity → plain label + color token */
export function humanizeSeverity(score: number | string | null | undefined) {
  if (score == null) return { label: "Unknown", tone: "muted" as const, action: "Review when convenient" };
  const s = typeof score === "string"
    ? ({ critical: 95, high: 75, medium: 50, low: 25 } as Record<string, number>)[score.toLowerCase()] ?? 50
    : norm(score);

  if (s >= 85) return { label: "Critical",  tone: "destructive" as const, action: "Act today" };
  if (s >= 65) return { label: "High",      tone: "warning"     as const, action: "Act this week" };
  if (s >= 40) return { label: "Moderate",  tone: "primary"     as const, action: "Monitor closely" };
  return         { label: "Low",       tone: "muted"       as const, action: "No action needed" };
}

/** Confidence → plain label */
export function humanizeConfidence(score: number | null | undefined) {
  if (score == null) return { label: "Unverified", tone: "muted" as const };
  const s = norm(score);
  if (s >= 85) return { label: "Very confident", tone: "success" as const };
  if (s >= 70) return { label: "Confident",      tone: "primary" as const };
  if (s >= 50) return { label: "Likely",         tone: "warning" as const };
  return         { label: "Uncertain",      tone: "muted"   as const };
}

/** Trend → plain English */
export function humanizeTrend(direction?: "up" | "down" | "stable" | string) {
  if (direction === "up") return "Getting worse";
  if (direction === "down") return "Improving";
  if (direction === "stable") return "Stable";
  return "No change yet";
}

/** Time-since for "last updated" */
export function humanizeTimeAgo(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
