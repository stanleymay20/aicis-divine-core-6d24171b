import type { EpistemicStatus, Provenance } from "./contracts";

export interface ExtractionCandidate {
  statement: string;
  subjectEntityId?: string;
  predicate?: string;
  objectEntityId?: string;
  objectValue?: unknown;
  confidence?: number | null;
  confidenceSemantics?: string;
  provenance: Provenance[];
  directObservation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EvidenceAssessment {
  epistemicStatus: EpistemicStatus;
  confidence: null;
  confidenceSemantics: string;
  extractorConfidence: number | null;
  extractorConfidenceSemantics: string;
  distinctSourceIdentifiers: number;
  sourceTypes: number;
  sourceIndependenceStatus: "not_assessed";
  hasDirectObservation: boolean;
  reasons: string[];
}

/**
 * Characterizes an NLP extraction without manufacturing epistemic confidence.
 *
 * Distinct source identifiers are useful provenance metadata, but they are not
 * proof that the underlying sources are independent. Extractor/model confidence
 * is retained separately and is never promoted into claim confidence here.
 */
export function assessExtraction(candidate: ExtractionCandidate): EvidenceAssessment {
  const provenance = dedupeProvenance(candidate.provenance);
  const sourceIds = new Set(provenance.map((item) => item.sourceId.trim().toLowerCase()));
  const sourceTypes = new Set(provenance.map((item) => item.sourceType.trim().toLowerCase()));
  const extractorConfidence = validUnitIntervalOrNull(candidate.confidence);
  const extractorConfidenceSemantics = extractorConfidence === null
    ? "extractor_confidence_unknown_not_quantified"
    : candidate.confidenceSemantics ?? "caller_supplied_extractor_score_semantics_unspecified";
  const hasDirectObservation = Boolean(candidate.directObservation && provenance.length > 0);
  const reasons: string[] = [];

  if (provenance.length === 0) {
    reasons.push("No provenance supplied; extraction remains unverified");
  } else {
    reasons.push(`${sourceIds.size} distinct source identifier(s) are attached`);
    reasons.push("Distinct source identifiers are not treated as proof of source independence");
  }

  if (hasDirectObservation) {
    reasons.push("Caller marked the evidence as a direct observation and provenance is present");
  } else if (candidate.directObservation) {
    reasons.push("Direct-observation flag was supplied without provenance and was not accepted as observed evidence");
  } else {
    reasons.push("No direct-observation claim was supplied; extraction remains unverified pending a separate verification/inference step");
  }

  if (extractorConfidence !== null) {
    reasons.push("Extractor score retained as model/extractor metadata only; it is not epistemic confidence");
  }

  return {
    epistemicStatus: hasDirectObservation ? "observed" : "unverified",
    confidence: null,
    confidenceSemantics: "not_quantified_extraction_evidence_assessment",
    extractorConfidence,
    extractorConfidenceSemantics,
    distinctSourceIdentifiers: sourceIds.size,
    sourceTypes: sourceTypes.size,
    sourceIndependenceStatus: "not_assessed",
    hasDirectObservation,
    reasons,
  };
}

export function dedupeProvenance(provenance: Provenance[]): Provenance[] {
  const seen = new Set<string>();
  const result: Provenance[] = [];

  for (const item of provenance) {
    const key = [
      item.sourceId.trim().toLowerCase(),
      item.sourceUri?.trim().toLowerCase() ?? "",
      item.evidenceHash?.trim().toLowerCase() ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

/** Canonical mention normalization for candidate matching, not final entity identity. */
export function normalizeMention(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic token-overlap candidate matching only. A positive result is a
 * resolution suggestion, not evidence that two real-world entities are identical.
 */
export function mentionsLikelyMatch(a: string, b: string): boolean {
  const left = normalizeMention(a);
  const right = normalizeMention(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && intersection / union >= 0.8;
}

/**
 * Contradiction changes epistemic state but does not create a new numeric
 * confidence through an arbitrary subtraction formula.
 */
export function contradictoryAssessment(reason = "Material contradictory evidence is attached to this claim"): EvidenceAssessment {
  return {
    epistemicStatus: "contradicted",
    confidence: null,
    confidenceSemantics: "not_quantified_contradicted_assessment",
    extractorConfidence: null,
    extractorConfidenceSemantics: "not_applicable",
    distinctSourceIdentifiers: 0,
    sourceTypes: 0,
    sourceIndependenceStatus: "not_assessed",
    hasDirectObservation: false,
    reasons: [reason],
  };
}

function validUnitIntervalOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}
