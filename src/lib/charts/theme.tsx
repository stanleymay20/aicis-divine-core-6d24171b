/**
 * Unified Recharts theme tokens for AICIS.
 * All colors resolve through CSS variables so they stay theme-aware.
 */

export const chartColors = {
  primary: "hsl(var(--primary))",
  primaryGlow: "hsl(var(--primary-glow))",
  secondary: "hsl(var(--secondary))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
};

/** Categorical palette for series — perceptually distinct, brand-aligned */
export const chartPalette = [
  "hsl(210, 100%, 56%)",  // primary blue
  "hsl(170, 60%, 48%)",   // teal
  "hsl(38, 92%, 55%)",    // amber
  "hsl(280, 65%, 60%)",   // violet
  "hsl(152, 60%, 48%)",   // green
  "hsl(0, 72%, 58%)",     // red
  "hsl(195, 85%, 55%)",   // cyan
  "hsl(330, 70%, 60%)",   // pink
];

/** Standard tooltip styling for Recharts <Tooltip /> */
export const chartTooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  color: "hsl(var(--popover-foreground))",
  boxShadow: "0 8px 24px -8px rgba(0,0,0,0.4)",
};

export const chartTooltipLabelStyle = {
  color: "hsl(var(--muted-foreground))",
  fontSize: "11px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: "4px",
};

/** Standard axis styling */
export const chartAxisStyle = {
  fontSize: 11,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fill: "hsl(var(--muted-foreground))",
};

/** Grid styling — minimal, subtle */
export const chartGridStyle = {
  stroke: "hsl(var(--border))",
  strokeDasharray: "2 4",
  strokeOpacity: 0.5,
};

/** Default smooth animation for line/area charts */
export const chartAnimation = {
  animationDuration: 600,
  animationEasing: "ease-out" as const,
};

/** Gradient defs helper — call inside <defs> */
export const ChartGradients = () => (
  <defs>
    <linearGradient id="aicis-primary-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
    </linearGradient>
    <linearGradient id="aicis-success-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.4} />
      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
    </linearGradient>
    <linearGradient id="aicis-warning-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.4} />
      <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
    </linearGradient>
  </defs>
);
