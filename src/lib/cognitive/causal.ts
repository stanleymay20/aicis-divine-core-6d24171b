import type { EvidenceClaim, WorldRelationship } from "./contracts";

export type CausalVerdict =
  | "insufficient-evidence"
  | "associated"
  | "temporally-plausible"
  | "mechanistically-supported"
  | "causally-supported"
  | "contradicted";

export interface CausalEvidenceProfile {
  supportingClaims: EvidenceClaim[];
  contradictingClaims?: EvidenceClaim[];
  mechanismEvidence?: EvidenceClaim[];
  temporalEvidence?: EvidenceClaim[];
  confounderEvidence?: EvidenceClaim[];
  interventionEvidence?: EvidenceClaim[];
  counterfactualEvidence?: EvidenceClaim[];
}

export interface CausalAssessment {
  verdict: CausalVerdict;
  score: number;
  confidence: number;
  temporalPrecedence: number;
  mechanismSupport: number;
  evidenceDiversity: number;
  contradictionPenalty: number;
  confounderPenalty: number;
  interventionSupport: number;
  counterfactualSupport: number;
  reasons: string[];
}

/**
 * Evidence-first causal scoring. This is deliberately conservative: correlation,
 * graph connectivity and language-model assertions cannot by themselves produce a
 * causal verdict. The output is a structured assessment for human/model review,
 * not proof of causation.
 */
export function assessCausalRelationship(
  relationship: WorldRelationship,
  evidence: CausalEvidenceProfile,
): CausalAssessment {
  const supports = evidence.supportingClaims ?? [];
  const contradicts = evidence.contradictingClaims ?? [];
  const mechanisms = evidence.mechanismEvidence ?? [];
  const temporal = evidence.temporalEvidence ?? [];
  const confounders = evidence.confounderEvidence ?? [];
  const interventions = evidence.interventionEvidence ?? [];
  const counterfactuals = evidence.counterfactualEvidence ?? [];

  const evidenceDiversity = sourceDiversityScore(supports);
  const temporalPrecedence = temporalPrecedenceScore(temporal);
  const mechanismSupport = weightedClaimSupport(mechanisms);
  const contradictionPenalty = weightedClaimSupport(contradicts);
  const confounderPenalty = weightedClaimSupport(confounders);
  const interventionSupport = weightedClaimSupport(interventions);
  const counterfactualSupport = weightedClaimSupport(counterfactuals);
  const baseSupport = weightedClaimSupport(supports);

  const raw =
    0.2 * baseSupport +
    0.15 * evidenceDiversity +
    0.18 * temporalPrecedence +
    0.17 * mechanismSupport +
    0.15 * interventionSupport +
    0.15 * counterfactualSupport -
    0.18 * contradictionPenalty -
    0.14 * confounderPenalty;

  const score = clamp01(raw);
  const confidence = clamp01(
    0.45 * score +
      0.25 * clamp01(relationship.confidence) +
      0.15 * evidenceDiversity +
      0.15 * Math.min(1, supports.length / 5),
  );

  const reasons: string[] = [];
  if (supports.length === 0) reasons.push("No supporting evidence claims are attached");
  if (temporalPrecedence >= 0.6) reasons.push("Temporal evidence is consistent with cause preceding effect");
  if (mechanismSupport >= 0.6) reasons.push("A plausible mechanism is supported by evidence");
  if (interventionSupport >= 0.5) reasons.push("Intervention/quasi-experimental evidence supports the direction");
  if (counterfactualSupport >= 0.5) reasons.push("Counterfactual evidence supports the relationship");
  if (contradictionPenalty >= 0.4) reasons.push("Material contradictory evidence exists");
  if (confounderPenalty >= 0.4) reasons.push("Plausible confounding explanations remain material");

  let verdict: CausalVerdict;
  if (contradictionPenalty >= 0.75 && score < 0.35) {
    verdict = "contradicted";
  } else if (supports.length < 2 || confidence < 0.35) {
    verdict = "insufficient-evidence";
  } else if (score < 0.45) {
    verdict = "associated";
  } else if (temporalPrecedence >= 0.55 && score < 0.62) {
    verdict = "temporally-plausible";
  } else if (temporalPrecedence >= 0.55 && mechanismSupport >= 0.55 && score < 0.78) {
    verdict = "mechanistically-supported";
  } else if (
    score >= 0.78 &&
    temporalPrecedence >= 0.65 &&
    mechanismSupport >= 0.6 &&
    (interventionSupport >= 0.45 || counterfactualSupport >= 0.45) &&
    contradictionPenalty < 0.5
  ) {
    verdict = "causally-supported";
  } else {
    verdict = "mechanistically-supported";
  }

  if (reasons.length === 0) reasons.push("Evidence remains mixed or incomplete");

  return {
    verdict,
    score,
    confidence,
    temporalPrecedence,
    mechanismSupport,
    evidenceDiversity,
    contradictionPenalty,
    confounderPenalty,
    interventionSupport,
    counterfactualSupport,
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
  supported: boolean;
  pathConfidence: number;
  weakestEdgeScore: number;
  weakestRelationshipId?: string;
  reasons: string[];
}

/** Confidence compounds across a chain; one weak link can block causal promotion. */
export function assessCausalChain(edges: CausalChainEdge[]): CausalChainAssessment {
  if (edges.length === 0) {
    return {
      supported: false,
      pathConfidence: 0,
      weakestEdgeScore: 0,
      reasons: ["No causal edges supplied"],
    };
  }

  let pathConfidence = 1;
  let weakestEdgeScore = 1;
  let weakestRelationshipId: string | undefined;

  for (const edge of edges) {
    pathConfidence *= clamp01(edge.assessment.confidence);
    if (edge.assessment.score < weakestEdgeScore) {
      weakestEdgeScore = edge.assessment.score;
      weakestRelationshipId = edge.relationshipId;
    }
  }

  const supported =
    edges.every((edge) =>
      edge.assessment.verdict === "causally-supported" ||
      edge.assessment.verdict === "mechanistically-supported"
    ) &&
    weakestEdgeScore >= 0.55 &&
    pathConfidence >= 0.3;

  return {
    supported,
    pathConfidence,
    weakestEdgeScore,
    weakestRelationshipId,
    reasons: supported
      ? ["Every edge crossed the minimum causal-support threshold"]
      : ["At least one edge remains too weak or uncertain for causal-chain promotion"],
  };
}

function weightedClaimSupport(claims: EvidenceClaim[]): number {
  if (claims.length === 0) return 0;
  const weights = claims.map((claim) => {
    const statusWeight =
      claim.epistemicStatus === "observed" ? 1 :
      claim.epistemicStatus === "derived" ? 0.9 :
      claim.epistemicStatus === "inferred" ? 0.75 :
      claim.epistemicStatus === "predicted" ? 0.35 :
      claim.epistemicStatus === "hypothesized" ? 0.25 :
      claim.epistemicStatus === "contradicted" ? 0.1 : 0.2;
    return clamp01(claim.confidence) * statusWeight;
  });
  return clamp01(weights.reduce((sum, value) => sum + value, 0) / Math.min(3, Math.max(1, weights.length)));
}

function sourceDiversityScore(claims: EvidenceClaim[]): number {
  const sourceIds = new Set<string>();
  const sourceTypes = new Set<string>();
  for (const claim of claims) {
    for (const source of claim.provenance) {
      sourceIds.add(source.sourceId.toLowerCase());
      sourceTypes.add(source.sourceType.toLowerCase());
    }
  }
  return clamp01(0.7 * Math.min(1, sourceIds.size / 4) + 0.3 * Math.min(1, sourceTypes.size / 3));
}

function temporalPrecedenceScore(claims: EvidenceClaim[]): number {
  if (claims.length === 0) return 0;
  const explicit = claims.filter((claim) => claim.occurredAt || claim.validFrom).length;
  const observed = claims.filter(
    (claim) => claim.epistemicStatus === "observed" || claim.epistemicStatus === "derived",
  ).length;
  return clamp01(0.65 * explicit / claims.length + 0.35 * observed / claims.length);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
