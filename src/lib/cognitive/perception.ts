import type { EpistemicStatus, Provenance } from "./contracts";

export interface ExtractionCandidate {
  statement: string;
  subjectEntityId?: string;
  predicate?: string;
  objectEntityId?: string;
  objectValue?: unknown;
  confidence: number;
  provenance: Provenance[];
  directObservation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EvidenceAssessment {
  epistemicStatus: EpistemicStatus;
  confidence: number;
  independentSources: number;
  sourceTypes: number;
  hasDirectObservation: boolean;
  reasons: string[];
}

/**
 * Converts a language-model/NLP extraction into an epistemic assessment without
 * allowing the extractor to declare its own output factual.
 */
export function assessExtraction(candidate: ExtractionCandidate): EvidenceAssessment {
  const provenance = dedupeProvenance(candidate.provenance);
  const sourceIds = new Set(provenance.map((item) => item.sourceId));
  const sourceTypes = new Set(provenance.map((item) => item.sourceType));
  const extractionConfidence = clamp01(candidate.confidence);
  const hasDirectObservation = Boolean(candidate.directObservation);
  const reasons: string[] = [];

  if (provenance.length === 0) {
    return {
      epistemicStatus: "unverified",
      confidence: Math.min(0.25, extractionConfidence),
      independentSources: 0,
      sourceTypes: 0,
      hasDirectObservation,
      reasons: ["No provenance supplied"],
    };
  }

  // Multiple independent sources can strengthen an inference, but agreement is
  // not proof of direct observation or causality.
  const diversityBoost = Math.min(0.15, Math.max(0, sourceIds.size - 1) * 0.05);
  const typeBoost = Math.min(0.1, Math.max(0, sourceTypes.size - 1) * 0.025);
  const assessedConfidence = clamp01(extractionConfidence + diversityBoost + typeBoost);

  if (hasDirectObservation) {
    reasons.push("Direct observation is backed by provenance");
    return {
      epistemicStatus: "observed",
      confidence: assessedConfidence,
      independentSources: sourceIds.size,
      sourceTypes: sourceTypes.size,
      hasDirectObservation,
      reasons,
    };
  }

  if (sourceIds.size >= 2 && assessedConfidence >= 0.7) {
    reasons.push("Independent sources support the extracted claim");
    return {
      epistemicStatus: "inferred",
      confidence: assessedConfidence,
      independentSources: sourceIds.size,
      sourceTypes: sourceTypes.size,
      hasDirectObservation,
      reasons,
    };
  }

  reasons.push("Evidence exists but has not crossed the inference threshold");
  return {
    epistemicStatus: "unverified",
    confidence: assessedConfidence,
    independentSources: sourceIds.size,
    sourceTypes: sourceTypes.size,
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

export function contradictoryAssessment(
  currentConfidence: number,
  contradictionWeight: number,
): EvidenceAssessment {
  const confidence = clamp01(currentConfidence * (1 - clamp01(contradictionWeight)));
  return {
    epistemicStatus: "contradicted",
    confidence,
    independentSources: 0,
    sourceTypes: 0,
    hasDirectObservation: false,
    reasons: ["Material contradictory evidence is attached to this claim"],
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
