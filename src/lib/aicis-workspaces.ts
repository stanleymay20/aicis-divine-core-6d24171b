import {
  BarChart3,
  DatabaseZap,
  Globe2,
  LayoutDashboard,
  ShieldCheck,
  Target,
  TrendingUp,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AICISWorkspaceId =
  | "world"
  | "brief"
  | "analysis"
  | "forecasts"
  | "opportunities"
  | "decisions"
  | "data-trust"
  | "system";

export type AICISWorkspaceDefinition = {
  id: AICISWorkspaceId;
  label: string;
  description: string;
  icon: LucideIcon;
  path: string;
  match: string[];
  keywords: string;
};

export const AICIS_WORKSPACES: readonly AICISWorkspaceDefinition[] = [
  {
    id: "world",
    label: "World",
    description: "Global map and live situation",
    icon: Globe2,
    path: "/world",
    match: [
      "/world",
      "/command-center",
      "/risk-atlas",
      "/atlas",
      "/live",
      "/live-signals",
      "/live-stream",
      "/local-events",
      "/spatial-cockpit",
      "/cockpit",
    ],
    keywords: "map live signals global situation country event",
  },
  {
    id: "brief",
    label: "Brief",
    description: "Executive intelligence synthesis",
    icon: LayoutDashboard,
    path: "/morning-brief",
    match: ["/morning-brief", "/brief"],
    keywords: "morning executive synthesis changed attention",
  },
  {
    id: "analysis",
    label: "Analysis",
    description: "Research, causality and deep dives",
    icon: BarChart3,
    path: "/analyst",
    match: [
      "/analyst",
      "/analyst-dashboard",
      "/intelligence-engine",
      "/planetary-intelligence",
      "/planetary-graph",
      "/resolution",
      "/deepdive",
      "/risk-ranking",
    ],
    keywords: "research graph causality deep dive geography analyst",
  },
  {
    id: "forecasts",
    label: "Forecasts",
    description: "Predictions, scenarios and outcomes",
    icon: Target,
    path: "/forecast-validation",
    match: [
      "/forecast-validation",
      "/predictions",
      "/simulation",
      "/learning",
      "/learning-loop",
      "/outcome-cockpit",
    ],
    keywords: "prediction probability scenario validation outcome learning",
  },
  {
    id: "opportunities",
    label: "Opportunities",
    description: "Personalized transaction research and ranking",
    icon: TrendingUp,
    path: "/opportunities",
    match: [
      "/opportunities",
      "/alpha-radar",
      "/morning-opportunities",
      "/relevance-preferences",
    ],
    keywords: "opportunity research ranking transaction relevance",
  },
  {
    id: "decisions",
    label: "Decisions",
    description: "Governed decisions and watchlists",
    icon: Workflow,
    path: "/decision-ops",
    match: ["/decision-ops", "/decisions", "/watchlist"],
    keywords: "decisions watchlist monitoring review outcome",
  },
  {
    id: "data-trust",
    label: "Data & Trust",
    description: "Evidence, provenance and integrity",
    icon: ShieldCheck,
    path: "/governance",
    match: [
      "/governance",
      "/evidence-command",
      "/daily-evidence-ops",
      "/signal-validation",
      "/operational-truth",
      "/coverage-equity",
      "/pilot-truth",
      "/data-integrity",
      "/training-dataset",
      "/accumulation",
    ],
    keywords: "evidence provenance validation integrity coverage governance truth",
  },
  {
    id: "system",
    label: "System",
    description: "Health, APIs, exports and administration",
    icon: DatabaseZap,
    path: "/system-pulse",
    match: [
      "/system-pulse",
      "/system-status",
      "/system-catalog",
      "/infra-ops",
      "/data-pipeline",
      "/api-audit",
      "/advanced",
      "/more",
      "/developers",
      "/admin",
      "/export-center",
      "/data-export",
      "/export-layer",
      "/exports",
      "/quantivis-exports",
      "/federation-admin",
      "/register-node",
    ],
    keywords: "health pipeline operations api developer export federation admin",
  },
] as const;

export const workspaceForPath = (
  pathname: string,
): AICISWorkspaceDefinition | undefined =>
  AICIS_WORKSPACES.find((workspace) =>
    workspace.match.some(
      (path) =>
        pathname === path ||
        pathname.startsWith(`${path}/`),
    ),
  );

export const persistedWorkspaceSearch = (search: string): string => {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();

  for (const key of ["entity", "question"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }

  return next.toString();
};
