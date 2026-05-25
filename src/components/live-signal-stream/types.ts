export type RelevanceTier = "critical" | "important" | "monitor" | "discovery" | "hidden";
export type VisibilityTab = RelevanceTier | "raw";
export type OperationalFilter = "all" | "recovery" | "high_impact";

export type RelevanceScore = {
  signal_id: string;
  relevance_score: number;
  relevance_tier: RelevanceTier;
  relevance_reason: any;
  computed_at: string;
};

export type Signal = {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  primary_source: string | null;
  canonical_source_name: string | null;
  ingestion_source: string | null;
  source_trust_tier: string | null;
  confidence_score: number | null;
  impact_score: number | null;
  urgency_score: number | null;
  affected_countries: string[] | null;
  first_detected_at: string;
  ingested_at: string | null;
  canonical_event_status: string | null;
  corroboration_count: number | null;
  propaganda_risk_score: number | null;
  source_credibility_score: number | null;
  confidence_explanation: any;
  source_language: string | null;
  translated_title: string | null;
  translation_status: string | null;
  language_tier: string | null;
  script_detected: string | null;
  country_extraction_method: string | null;
  country_extraction_confidence: number | null;
  detection_latency_seconds: number | null;
  last_pipeline_stage: string | null;
  novelty_score?: number | null;
  relevance_score?: number | null;
  relevance_tier?: RelevanceTier | null;
  relevance_reason?: any;
  relevance_computed_at?: string | null;
  relevance_is_fallback?: boolean;
};

export const WINDOW_MS = 30 * 60 * 1000;
