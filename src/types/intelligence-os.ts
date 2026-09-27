export type AICISEntityType =
  | "country"
  | "region"
  | "locality"
  | "organization"
  | "person"
  | "sector"
  | "commodity"
  | "technology"
  | "event"
  | "signal"
  | "risk"
  | "forecast"
  | "opportunity"
  | "decision"
  | "source"
  | "pipeline"
  | "graph_node";

export type InspectorTab =
  | "overview"
  | "evidence"
  | "signals"
  | "forecasts"
  | "relationships"
  | "history"
  | "ask";

export interface ProvenanceReference {
  id: string;
  label: string;
  sourceType?: string;
  url?: string;
  observedAt?: string;
}

export interface AICISEntity {
  id: string;
  type: AICISEntityType;
  name: string;
  description?: string;
  confidence?: number;
  evidenceCoverage?: number;
  sourceCount?: number;
  observedAt?: string;
  updatedAt?: string;
  geography?: {
    country?: string;
    region?: string;
    locality?: string;
  };
  provenance?: ProvenanceReference[];
  metadata?: Record<string, string | number | boolean | null>;
}
