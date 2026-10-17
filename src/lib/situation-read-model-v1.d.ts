export type SituationCorroborationState = "established" | "not_established" | "unknown";
export type SituationReviewState = "unreviewed" | "confirmed" | "rejected" | "unclear" | "conflicted";
export type SituationOperationalState = "not_recorded" | "recorded" | "action_recorded" | "outcome_observed";
export type SituationIdentityStatus = "verified_canonical_group" | "unresolved_duplicate_candidate" | "standalone_signal";

export type SituationSignalV1 = {
  id: string;
  title?: string | null;
  summary?: string | null;
  category?: string | null;
  status?: string | null;
  canonical_event_id?: string | null;
  duplicate_of_signal_id?: string | null;
  canonical_event_status?: string | null;
  duplicate_match_status?: string | null;
  canonical_source_name?: string | null;
  primary_source?: string | null;
  source_trust_tier?: string | null;
  confidence_score?: number | null;
  impact_score?: number | null;
  urgency_score?: number | null;
  affected_countries?: string[] | null;
  affected_regions?: string[] | null;
  affected_sectors?: string[] | null;
  affected_stakeholders?: string[] | null;
  first_detected_at?: string | null;
  latest_update_at?: string | null;
  occurred_at?: string | null;
  ingested_at?: string | null;
  corroboration_count?: number | null;
  multi_source_confirmed?: boolean | null;
  official_source_present?: boolean | null;
  uncertainty_notes?: string | null;
  enrichment_status?: string | null;
};

export type SituationFeedbackV1 = {
  signal_id: string;
  feedback: string;
  created_at?: string | null;
};

export type SituationOutcomeV1 = {
  signal_id: string;
  action_taken?: boolean | null;
  outcome_success?: boolean | null;
  execution_status?: string | null;
  evidence_type?: string | null;
  outcome_timestamp?: string | null;
};

export type SituationV1 = {
  id: string;
  representativeSignalId: string;
  memberSignalIds: string[];
  title: string;
  summary: string | null;
  category: string | null;
  signalStatus: string | null;
  identityStatus: SituationIdentityStatus;
  reportCount: number;
  sourceIdentifiers: string[];
  sourceIdentifierCount: number;
  sourceIdentifierSemantics: string;
  corroboration: {
    state: SituationCorroborationState;
    independentOriginCount: number | null;
    semantics: string;
  };
  contradiction: {
    state: "unknown_not_modeled";
    semantics: string;
  };
  affectedCountries: string[];
  affectedRegions: string[];
  affectedSectors: string[];
  affectedStakeholders: string[];
  firstDetectedAt: string | null;
  latestObservedAt: string | null;
  occurredAt: string | null;
  signalTrustScore: number | null;
  signalTrustSemantics: string;
  impactScore: number | null;
  urgencyScore: number | null;
  sourceTrustTier: string | null;
  officialSourcePresent: boolean | null;
  uncertaintyNotes: string | null;
  enrichmentStatus: string | null;
  review: {
    state: SituationReviewState;
    count: number;
    latestAt: string | null;
  };
  operational: {
    state: SituationOperationalState;
    recordCount: number;
    outcomeCount: number;
    semantics: string;
  };
  forecast: {
    state: "not_linked";
    probability: null;
    semantics: string;
  };
  coverage: {
    sourceIdentity: "present" | "unknown";
    geography: "present" | "unknown";
    affectedContext: "present" | "unknown";
    timing: "present" | "unknown";
    corroboration: SituationCorroborationState;
    contradictions: "unknown_not_modeled";
  };
  needsReview: boolean;
};

export function situationKeyForSignalV1(signal: SituationSignalV1): string | null;

export function buildSituationsV1(input?: {
  signals?: SituationSignalV1[];
  feedback?: SituationFeedbackV1[];
  outcomes?: SituationOutcomeV1[];
}): SituationV1[];
