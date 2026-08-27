import type { EvidenceClaim, WorldRelationship } from "./contracts";
import { hasQuantifiedUnitInterval } from "./contracts";

const CAUSAL_SCORE_SEMANTICS =
  "deterministic_attached_evidence_screen_v3_source_identifier_diversity_excluded_not_probability";
const CONFIDENCE_SEMANTICS =
  "no_calibrated_causal_confidence_issued";
const SOURCE_DIVERSITY_SEMANTICS =
  "distinct_source_identifier_diversity_descriptive_only_excluded_from_causal_score_not_source_independence";
const SOURCE_INDEPENDENCE_SEMANTICS =
  "cascade_review_requires_complete_current_claim_set_lineage_and_at_least_two_established_independent_origins";
const TEMPORAL_SEMANTICS =
  "requires_explicit_mapped_cause_effect_temporal_assessment_not_timestamp_presence";
const CHAIN_SCORE_SEMANTICS =
  "multiplicative_deterministic_causal_screen_score_not_probability";

export type CausalVerdict =
  | "insufficient-evidence"
  | "associated"
  | "temporally-plausible"
  | "mechanistically-supported"
  | "causally-supported"
  | "contradicted";

export type SourceIndependenceStatus =
  | "not_assessed"
  | "partial"
  | "complete_not_corroborated"
  | "established"
  | "conflicted"
  | "stale_claim_set";

export interface ExplicitTemporalAssessment {
  relation: "before" | "after" | "simultaneous" | "unknown";
  plausibleForwardCausation: boolean;
  method: string;
}

export interface SourceIndependenceAssessmentInput {
  assessmentId?: string;
  claimIds: string[];
  lineageStatus: "not_assessed" | "partial" | "complete" | "conflicted";
  corroborationStatus: "not_established" | "established" | "conflicted";
  independentOriginCount: number | null;
  semantics?: string;
}

export interface CausalEvidenceProfile {
  supportingClaims: EvidenceClaim[];
  contradictingClaims?: EvidenceClaim[];
  mechanismEvidence?: EvidenceClaim[];
  temporalEvidence?: EvidenceClaim[];
  temporalAssessment?: ExplicitTemporalAssessment;
  confounderEvidence?: EvidenceClaim[];
  interventionEvidence?: EvidenceClaim[];
  counterfactualEvidence?: EvidenceClaim[];
  sourceIndependenceAssessment?: SourceIndependenceAssessmentInput;
}

export interface CausalAssessment {
  verdict: CausalVerdict;
  score: number | null;
  scoreSemantics: string;
  confidence: null;
  confidenceSemantics: string;
  temporalPrecedence: number | null;
  temporalPrecedenceSemantics: string;
  mechanismSupport: number | null;
  evidenceDiversity: number;
  evidenceDiversitySemantics: string;
  sourceIndependenceStatus: SourceIndependenceStatus;
  sourceIndependenceSemantics: string;
  independentOriginCount: number | null;
  sourceIndependenceAssessmentId?: string;
  contradictionPenalty: number | null;
  confounderPenalty: number | null;
  interventionSupport: number | null;
  counterfactualSupport: number | null;
  quantitativeEvidenceStatus:
    | "no_attached_evidence"
    | "complete_for_attached_evidence"
    | "attached_evidence_unquantified"
    | "partial_quantitative_coverage";
  eligibleForCascadeReview: boolean;
  autoCausalPromotionPerformed: false;
  reasons: string[];
}

interface EvidenceScore {
  score: number | null;
  claimCount: number;
  quantifiedCount: number;
  unquantifiedCount: number;
}

interface SourceIndependenceGate {
  status: SourceIndependenceStatus;
  established: boolean;
  independentOriginCount: number | null;
  assessmentId?: string;
}

/**
 * Evidence-screening helper, not a causal truth engine.
 *
 * Rules:
 * - attached evidence with unknown numeric semantics forces quantitative abstention;
 * - timestamp presence is never converted into temporal precedence;
 * - distinct source identifiers remain descriptive and never increase causal score;
 * - cascade review requires a current, complete lineage assessment establishing
 *   at least two independent origins for the exact supporting-claim set;
 * - the automated client layer never emits `causally-supported`;
 * - returned scores are deterministic screening heuristics, not probabilities.
 */
export function assessCausalRelationship(
  relationship: WorldRelationship,
  evidence: CausalEvidenceProfile,
): CausalAssessment {
  const supports = dedupeClaims(evidence.supportingClaims ?? []);
  const contradicts = dedupeClaims(evidence.contradictingClaims ?? []);
  const mechanisms = dedupeClaims(evidence.mechanismEvidence ?? []);
  const confounders = dedupeClaims(evidence.confounderEvidence ?? []);
  const interventions = dedupeClaims(evidence.interventionEvidence ?? []);
  const counterfactuals = dedupeClaims(evidence.counterfactualEvidence ?? []);
  const temporalClaims = dedupeClaims(evidence.temporalEvidence ?? []);

  const baseSupport = evidenceSupportScore(supports);
  const mechanismSupport = evidenceSupportScore(mechanisms);
  const contradictionPenalty = evidenceSupportScore(contradicts);
  const confounderPenalty = evidenceSupportScore(confounders);
  const interventionSupport = evidenceSupportScore(interventions);
  const counterfactualSupport = evidenceSupportScore(counterfactuals);
  const evidenceDiversity = sourceIdentifierDiversity(supports);
  const sourceIndependence = evaluateSourceIndependence(
    supports,
    evidence.sourceIndependenceAssessment,
  );

  const allRelevant = dedupeClaims([
    ...supports,
    ...contradicts,
    ...mechanisms,
    ...confounders,
    ...interventions,
    ...counterfactuals,
    ...temporalClaims,
  ]);
  const quantifiedCount = allRelevant.filter(hasExplicitClaimConfidence).length;
  const unquantifiedCount = allRelevant.length - quantifiedCount;
  const quantitativeEvidenceStatus = classifyQuantitativeCoverage(
    allRelevant.length,
    quantifiedCount,
    unquantifiedCount,
  );

  const categoryScores = [
    baseSupport,
    mechanismSupport,
    contradictionPenalty,
    confounderPenalty,
    interventionSupport,
    counterfactualSupport,
  ];
  const anyAttachedCategoryUnquantified = categoryScores.some(
    (item) => item.claimCount > 0 && item.score === null,
  );
  const canComputeScore =
    supports.length > 0 &&
    !anyAttachedCategoryUnquantified &&
    quantitativeEvidenceStatus === "complete_for_attached_evidence";

  const score = canComputeScore
    ? heuristicCausalEvidenceScore({
      baseSupport: scoreOrZeroWhenNoClaims(baseSupport),
      mechanismSupport: scoreOrZeroWhenNoClaims(mechanismSupport),
      interventionSupport: scoreOrZeroWhenNoClaims(interventionSupport),
      counterfactualSupport: scoreOrZeroWhenNoClaims(counterfactualSupport),
      contradictionPenalty: scoreOrZeroWhenNoClaims(contradictionPenalty),
      confounderPenalty: scoreOrZeroWhenNoClaims(confounderPenalty),
    })
    : null;

  const temporalPrecedence = explicitTemporalIndicator(evidence.temporalAssessment);
  const structuralInputsExplicit =
    hasQuantifiedUnitInterval(relationship.strength, relationship.strengthSemantics) &&
    hasQuantifiedUnitInterval(relationship.confidence, relationship.confidenceSemantics);

  let verdict: CausalVerdict = "insufficient-evidence";
  if (
    score !== null &&
    contradictionPenalty.score !== null &&
    contradictionPenalty.score >= 0.75 &&
    score < 0.35
  ) {
    verdict = "contradicted";
  } else if (score === null || supports.length < 2) {
    verdict = "insufficient-evidence";
  } else if (score < 0.45) {
    verdict = "associated";
  } else if (
    mechanismSupport.score !== null &&
    mechanismSupport.score >= 0.55 &&
    score >= 0.55
  ) {
    verdict = "mechanistically-supported";
  } else if (
    temporalPrecedence === 1 &&
    score >= 0.45
  ) {
    verdict = "temporally-plausible";
  } else {
    verdict = "associated";
  }

  const eligibleForCascadeReview =
    verdict === "mechanistically-supported" &&
    score !== null &&
    score >= 0.55 &&
    quantitativeEvidenceStatus === "complete_for_attached_evidence" &&
    structuralInputsExplicit &&
    sourceIndependence.established;

  const reasons: string[] = [];
  if (supports.length === 0) reasons.push("No supporting evidence claims are attached");
  if (unquantifiedCount > 0) {
    reasons.push(
      `${unquantifiedCount} attached evidence claim(s) have no usable numeric confidence semantics; quantitative causal screening abstained`,
    );
  }
  if (mechanisms.length > 0 && mechanismSupport.score !== null) {
    reasons.push("Mechanism-labeled evidence contributes to the deterministic evidence screen");
  }
  if (contradicts.length > 0) {
    reasons.push("Contradictory evidence is retained in the assessment rather than discarded");
  }
  if (confounders.length > 0) {
    reasons.push("Confounder-labeled evidence is retained in the assessment rather than discarded");
  }
  if (temporalClaims.length > 0 && !evidence.temporalAssessment) {
    reasons.push("Temporal-looking claims exist, but timestamp presence alone is not temporal precedence");
  }
  if (evidence.temporalAssessment?.relation === "before" && evidence.temporalAssessment.plausibleForwardCausation) {
    reasons.push("An explicit mapped temporal assessment places the proposed cause before the effect");
  }
  if (!structuralInputsExplicit) {
    reasons.push("Relationship strength/confidence is incomplete or lacks usable semantics; cascade review eligibility is withheld");
  }
  reasons.push("Distinct source identifiers are descriptive only and are excluded from the causal evidence score");
  reasons.push(sourceIndependenceReason(sourceIndependence));
  reasons.push("Automated client-side screening never promotes a relationship to causally-supported");

  return {
    verdict,
    score,
    scoreSemantics: CAUSAL_SCORE_SEMANTICS,
    confidence: null,
    confidenceSemantics: CONFIDENCE_SEMANTICS,
    temporalPrecedence,
    temporalPrecedenceSemantics: TEMPORAL_SEMANTICS,
    mechanismSupport: mechanismSupport.score,
    evidenceDiversity,
    evidenceDiversitySemantics: SOURCE_DIVERSITY_SEMANTICS,
    sourceIndependenceStatus: sourceIndependence.status,
    sourceIndependenceSemantics: SOURCE_INDEPENDENCE_SEMANTICS,
    independentOriginCount: sourceIndependence.independentOriginCount,
    sourceIndependenceAssessmentId: sourceIndependence.assessmentId,
    contradictionPenalty: contradictionPenalty.score,
    confounderPenalty: confounderPenalty.score,
    interventionSupport: interventionSupport.score,
    counterfactualSupport: counterfactualSupport.score,
    quantitativeEvidenceStatus,
    eligibleForCascadeReview,
    autoCausalPromotionPerformed: false,
    reasons,
  };
}

export interface CausalChainEdge {
  relationshipId: string;
  sourceEntityId: string;
  targetEntityId: string;
  assessment: CausalAssessment;
}

export interface CausalChainAssessment {
  supported: false;
  candidateForReview: boolean;
  pathConfidence: null;
  pathConfidenceSemantics: string;
  pathEvidenceScore: number | null;
  pathEvidenceScoreSemantics: string;
  weakestEdgeScore: number | null;
  weakestRelationshipId?: string;
  autoCausalPromotionPerformed: false;
  reasons: string[];
}

/**
 * Chain aggregation is a deterministic screening operation only. Multiplying
 * edge screen scores does not create a causal probability, and this function
 * never auto-promotes a chain to supported.
 */
export function assessCausalChain(edges: CausalChainEdge[]): CausalChainAssessment {
  if (edges.length === 0) {
    return {
      supported: false,
      candidateForReview: false,
      pathConfidence: null,
      pathConfidenceSemantics: CONFIDENCE_SEMANTICS,
      pathEvidenceScore: null,
      pathEvidenceScoreSemantics: CHAIN_SCORE_SEMANTICS,
      weakestEdgeScore: null,
      autoCausalPromotionPerformed: false,
      reasons: ["No causal edges supplied"],
    };
  }

  const scored = edges.filter((edge) => edge.assessment.score !== null);
  if (scored.length !== edges.length) {
    return {
      supported: false,
      candidateForReview: false,
      pathConfidence: null,
      pathConfidenceSemantics: CONFIDENCE_SEMANTICS,
      pathEvidenceScore: null,
      pathEvidenceScoreSemantics: CHAIN_SCORE_SEMANTICS,
      weakestEdgeScore: null,
      autoCausalPromotionPerformed: false,
      reasons: ["At least one edge lacks sufficient quantified evidence; chain scoring abstained"],
    };
  }

  let pathEvidenceScore = 1;
  let weakestEdgeScore = 1;
  let weakestRelationshipId: string | undefined;
  for (const edge of scored) {
    const edgeScore = edge.assessment.score as number;
    pathEvidenceScore *= edgeScore;
    if (edgeScore < weakestEdgeScore) {
      weakestEdgeScore = edgeScore;
      weakestRelationshipId = edge.relationshipId;
    }
  }

  const candidateForReview =
    edges.every((edge) => edge.assessment.verdict === "mechanistically-supported") &&
    edges.every((edge) => edge.assessment.eligibleForCascadeReview) &&
    edges.every((edge) => edge.assessment.sourceIndependenceStatus === "established") &&
    weakestEdgeScore >= 0.55 &&
    pathEvidenceScore >= 0.30;

  return {
    supported: false,
    candidateForReview,
    pathConfidence: null,
    pathConfidenceSemantics: CONFIDENCE_SEMANTICS,
    pathEvidenceScore,
    pathEvidenceScoreSemantics: CHAIN_SCORE_SEMANTICS,
    weakestEdgeScore,
    weakestRelationshipId,
    autoCausalPromotionPerformed: false,
    reasons: candidateForReview
      ? ["Every edge satisfies deterministic review thresholds and audited source-independence gates; manual or governed causal review is still required"]
      : ["At least one edge does not satisfy deterministic causal-chain review or source-independence thresholds"],
  };
}

function evidenceSupportScore(claims: EvidenceClaim[]): EvidenceScore {
  if (claims.length === 0) {
    return { score: 0, claimCount: 0, quantifiedCount: 0, unquantifiedCount: 0 };
  }

  const quantified = claims.filter(hasExplicitClaimConfidence);
  if (quantified.length !== claims.length) {
    return {
      score: null,
      claimCount: claims.length,
      quantifiedCount: quantified.length,
      unquantifiedCount: claims.length - quantified.length,
    };
  }

  const score = quantified.reduce((sum, claim) => sum + Number(claim.confidence), 0) / quantified.length;
  return {
    score: clamp01(score),
    claimCount: claims.length,
    quantifiedCount: quantified.length,
    unquantifiedCount: 0,
  };
}

function scoreOrZeroWhenNoClaims(value: EvidenceScore): number {
  if (value.claimCount === 0) return 0;
  if (value.score === null) {
    throw new Error("Cannot coerce unquantified attached evidence to zero");
  }
  return value.score;
}

function heuristicCausalEvidenceScore(input: {
  baseSupport: number;
  mechanismSupport: number;
  interventionSupport: number;
  counterfactualSupport: number;
  contradictionPenalty: number;
  confounderPenalty: number;
}): number {
  // Preserve the relative weights of the substantive positive evidence categories
  // after removing the former 15% distinct-source-ID term. Source independence is
  // handled only by the explicit corroboration gate above.
  const positiveEvidence = (
    0.28 * input.baseSupport +
    0.20 * input.mechanismSupport +
    0.14 * input.interventionSupport +
    0.13 * input.counterfactualSupport
  ) / 0.75;

  return clamp01(
    positiveEvidence -
    0.15 * input.contradictionPenalty -
    0.10 * input.confounderPenalty,
  );
}

function sourceIdentifierDiversity(claims: EvidenceClaim[]): number {
  if (claims.length === 0) return 0;
  const sourceIds = new Set<string>();
  const sourceTypes = new Set<string>();
  for (const claim of claims) {
    for (const source of claim.provenance) {
      sourceIds.add(source.sourceId.toLowerCase());
      sourceTypes.add(source.sourceType.toLowerCase());
    }
  }
  return clamp01(
    0.70 * Math.min(1, sourceIds.size / 4) +
    0.30 * Math.min(1, sourceTypes.size / 3),
  );
}

function evaluateSourceIndependence(
  supportingClaims: EvidenceClaim[],
  assessment: SourceIndependenceAssessmentInput | undefined,
): SourceIndependenceGate {
  if (!assessment) {
    return { status: "not_assessed", established: false, independentOriginCount: null };
  }

  const currentClaimIds = [...new Set(supportingClaims.map((claim) => claim.id))].sort();
  const assessedClaimIds = [...new Set(assessment.claimIds)].sort();
  if (!sameStringArray(currentClaimIds, assessedClaimIds)) {
    return {
      status: "stale_claim_set",
      established: false,
      independentOriginCount: null,
      assessmentId: assessment.assessmentId,
    };
  }

  if (assessment.lineageStatus === "conflicted" || assessment.corroborationStatus === "conflicted") {
    return {
      status: "conflicted",
      established: false,
      independentOriginCount: null,
      assessmentId: assessment.assessmentId,
    };
  }

  if (assessment.lineageStatus === "not_assessed") {
    return {
      status: "not_assessed",
      established: false,
      independentOriginCount: null,
      assessmentId: assessment.assessmentId,
    };
  }

  if (assessment.lineageStatus === "partial") {
    return {
      status: "partial",
      established: false,
      independentOriginCount: null,
      assessmentId: assessment.assessmentId,
    };
  }

  const independentOriginCount = Number.isInteger(assessment.independentOriginCount) &&
      Number(assessment.independentOriginCount) >= 0
    ? Number(assessment.independentOriginCount)
    : null;
  const established =
    assessment.lineageStatus === "complete" &&
    assessment.corroborationStatus === "established" &&
    independentOriginCount !== null &&
    independentOriginCount >= 2;

  return {
    status: established ? "established" : "complete_not_corroborated",
    established,
    independentOriginCount,
    assessmentId: assessment.assessmentId,
  };
}

function sourceIndependenceReason(gate: SourceIndependenceGate): string {
  switch (gate.status) {
    case "established":
      return `Source independence is established for the exact supporting-claim set with ${gate.independentOriginCount} explicit independent origins`;
    case "stale_claim_set":
      return "The supplied source-independence assessment does not match the current supporting-claim set; cascade review eligibility is withheld";
    case "conflicted":
      return "Source lineage is conflicted; independent corroboration is not established";
    case "partial":
      return "Source lineage coverage is partial; independent corroboration is not established";
    case "complete_not_corroborated":
      return "Source lineage is complete but fewer than two independent origins are established";
    default:
      return "Source independence has not been assessed for the exact supporting-claim set; cascade review eligibility is withheld";
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function explicitTemporalIndicator(
  assessment: ExplicitTemporalAssessment | undefined,
): number | null {
  if (!assessment) return null;
  if (assessment.relation === "before" && assessment.plausibleForwardCausation) return 1;
  if (assessment.relation === "after") return 0;
  return null;
}

function classifyQuantitativeCoverage(
  total: number,
  quantified: number,
  unquantified: number,
): CausalAssessment["quantitativeEvidenceStatus"] {
  if (total === 0) return "no_attached_evidence";
  if (unquantified === 0) return "complete_for_attached_evidence";
  if (quantified === 0) return "attached_evidence_unquantified";
  return "partial_quantitative_coverage";
}

function hasExplicitClaimConfidence(claim: EvidenceClaim): boolean {
  return hasQuantifiedUnitInterval(claim.confidence, claim.confidenceSemantics);
}

function dedupeClaims(claims: EvidenceClaim[]): EvidenceClaim[] {
  const seen = new Set<string>();
  const deduped: EvidenceClaim[] = [];
  for (const claim of claims) {
    if (seen.has(claim.id)) continue;
    seen.add(claim.id);
    deduped.push(claim);
  }
  return deduped;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}