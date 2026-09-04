import { createHash } from "node:crypto";

export const AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION = "aicis-evidence-fabric-contract-v1";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_CLASSES = new Set([
  "primary_official",
  "structured_dataset",
  "sensor_observation",
  "scientific_publication",
  "intergovernmental",
  "ngo_report",
  "commercial_intelligence",
  "news_media",
  "social_media",
  "cyber_threat_feed",
  "human_report",
  "derived_internal",
  "other",
]);
const KNOWLEDGE_STATUSES = new Set([
  "unverified",
  "verified_leakage_safe",
  "rejected_leakage_risk",
]);
const C2PA_STATUSES = new Set([
  "not_checked",
  "not_applicable",
  "manifest_verified",
  "manifest_invalid",
  "manifest_present_unverified",
]);
const CLAIM_ORIGINS = new Set([
  "direct_source_record",
  "extracted",
  "derived",
  "human_entered",
]);
const CLAIM_STATUSES = new Set([
  "observed",
  "derived",
  "inferred",
  "unverified",
  "contradicted",
]);
const CLAIM_ARTIFACT_RELATIONSHIPS = new Set([
  "source_of",
  "supports",
  "contradicts",
  "mentions",
  "context",
]);
const ASSESSMENT_STATUSES = new Set([
  "verified",
  "contradicted",
  "rejected",
  "insufficient_evidence",
  "superseded",
]);
const ASSESSMENT_METHODS = new Set([
  "direct_primary_source",
  "independent_source_corroboration",
  "structured_crosscheck",
  "human_review",
  "rule_based",
  "model_assisted",
]);
const ASSESSOR_TYPES = new Set([
  "human",
  "deterministic_system",
  "model_assisted_system",
  "external_authority",
]);
const LEGACY_TRUST_FIELDS = [
  "confidence",
  "quality_score",
  "reliability_score",
  "freshness_score",
];
const UNTRUSTED_CONFIDENCE_SEMANTICS = [
  "legacy",
  "unknown",
  "unspecified",
  "unverified",
  "not_quantified",
];

export function evaluateEvidenceArtifact(candidate) {
  const reasons = [];
  if (!isRecord(candidate)) return invalidResult("artifact_missing_or_invalid");
  if (candidate.contract_version !== AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION) reasons.push("contract_version_mismatch");
  if (!nonEmpty(candidate.source_id)) reasons.push("source_id_missing");
  if (!SOURCE_CLASSES.has(candidate.source_class)) reasons.push("source_class_invalid");
  if (!SHA256_RE.test(String(candidate.artifact_sha256 ?? ""))) reasons.push("artifact_sha256_invalid");
  if (!isDate(candidate.retrieved_at)) reasons.push("retrieved_at_invalid");
  if (!isDate(candidate.first_observed_at)) reasons.push("first_observed_at_invalid");
  if (!KNOWLEDGE_STATUSES.has(candidate.knowledge_time_status)) reasons.push("knowledge_time_status_invalid");
  if (!C2PA_STATUSES.has(candidate.c2pa_status ?? "not_checked")) reasons.push("c2pa_status_invalid");
  if (candidate.synthetic !== true && candidate.synthetic !== false) reasons.push("artifact_synthetic_flag_required");

  for (const field of LEGACY_TRUST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(candidate, field) && candidate[field] !== null && candidate[field] !== undefined) {
      reasons.push(`artifact_legacy_trust_field_forbidden:${field}`);
    }
  }

  const publishedAt = parseDate(candidate.published_at);
  const retrievedAt = parseDate(candidate.retrieved_at);
  const observedAt = parseDate(candidate.first_observed_at);
  const knowledgeTime = parseDate(candidate.knowledge_time);
  const verifiedAt = parseDate(candidate.knowledge_time_verified_at);

  if (candidate.knowledge_time_status === "verified_leakage_safe") {
    if (!knowledgeTime) reasons.push("verified_knowledge_time_missing");
    if (!verifiedAt) reasons.push("knowledge_time_verified_at_missing");
  }
  if (knowledgeTime && retrievedAt && knowledgeTime > retrievedAt) reasons.push("knowledge_time_after_retrieval");
  if (knowledgeTime && observedAt && knowledgeTime > observedAt) reasons.push("knowledge_time_after_first_observation");
  if (publishedAt && knowledgeTime && publishedAt > knowledgeTime) reasons.push("published_after_knowledge_time");
  if (knowledgeTime && verifiedAt && verifiedAt < knowledgeTime) reasons.push("knowledge_time_verification_precedes_knowledge_time");
  if (candidate.c2pa_status === "manifest_verified" && !SHA256_RE.test(String(candidate.c2pa_manifest_sha256 ?? ""))) {
    reasons.push("verified_c2pa_manifest_digest_missing");
  }

  const admissible = reasons.length === 0;
  const verifiedExternalEvidence = admissible &&
    candidate.knowledge_time_status === "verified_leakage_safe" &&
    candidate.source_class !== "derived_internal" &&
    candidate.synthetic === false &&
    candidate.c2pa_status !== "manifest_invalid";

  return freezeResult({ admissible, verified_external_evidence: verifiedExternalEvidence, reasons });
}

export function evaluateEvidenceClaim(candidate) {
  const reasons = [];
  if (!isRecord(candidate)) return invalidResult("claim_missing_or_invalid");
  if (candidate.contract_version !== AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION) reasons.push("contract_version_mismatch");
  if (!CLAIM_ORIGINS.has(candidate.claim_origin)) reasons.push("claim_origin_invalid");
  if (!nonEmpty(candidate.statement)) reasons.push("claim_statement_missing");
  if (!SHA256_RE.test(String(candidate.claim_sha256 ?? ""))) reasons.push("claim_sha256_invalid");
  if (!CLAIM_STATUSES.has(candidate.epistemic_status)) reasons.push("claim_epistemic_status_invalid");
  if (candidate.synthetic !== true && candidate.synthetic !== false) reasons.push("claim_synthetic_flag_required");
  if (["extracted", "derived"].includes(candidate.claim_origin) && !isUuid(candidate.transform_run_id)) {
    reasons.push("claim_transform_run_required");
  }
  validateNullableConfidence(candidate.confidence, candidate.confidence_semantics, reasons, "claim");
  validateInterval(candidate.valid_from, candidate.valid_to, reasons, "claim_valid_time");
  return freezeResult({ admissible: reasons.length === 0, reasons });
}

export function evaluateClaimArtifactLink(candidate) {
  const reasons = [];
  if (!isRecord(candidate)) return invalidResult("claim_artifact_link_missing_or_invalid");
  if (candidate.contract_version !== AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION) reasons.push("contract_version_mismatch");
  if (!isUuid(candidate.claim_id)) reasons.push("link_claim_id_invalid");
  if (!isUuid(candidate.artifact_id)) reasons.push("link_artifact_id_invalid");
  if (!CLAIM_ARTIFACT_RELATIONSHIPS.has(candidate.relationship)) reasons.push("link_relationship_invalid");
  return freezeResult({ admissible: reasons.length === 0, reasons });
}

export function canonicalEvidenceManifest(manifest) {
  if (!Array.isArray(manifest)) return null;
  const normalized = [];
  const artifactIds = new Set();
  for (const entry of manifest) {
    if (!isRecord(entry)) return null;
    const artifactId = typeof entry.artifact_id === "string" ? entry.artifact_id.trim().toLowerCase() : "";
    const artifactSha256 = typeof entry.artifact_sha256 === "string" ? entry.artifact_sha256.trim().toLowerCase() : "";
    const sourceId = typeof entry.source_id === "string" ? entry.source_id.trim() : "";
    if (!UUID_RE.test(artifactId) || !SHA256_RE.test(artifactSha256) || !sourceId) return null;
    if (artifactIds.has(artifactId)) return null;
    artifactIds.add(artifactId);
    normalized.push(Object.freeze({ artifact_id: artifactId, artifact_sha256: artifactSha256, source_id: sourceId }));
  }
  if (normalized.length === 0) return null;
  normalized.sort((a, b) =>
    a.artifact_id.localeCompare(b.artifact_id) ||
    a.artifact_sha256.localeCompare(b.artifact_sha256) ||
    a.source_id.localeCompare(b.source_id));
  return Object.freeze(normalized);
}

export function evidenceManifestSha256(manifest) {
  const canonical = canonicalEvidenceManifest(manifest);
  if (!canonical) return null;
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function evaluateClaimAssessment(candidate) {
  const reasons = [];
  if (!isRecord(candidate)) return invalidResult("assessment_missing_or_invalid");
  if (candidate.contract_version !== AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION) reasons.push("contract_version_mismatch");
  if (!isUuid(candidate.claim_id)) reasons.push("assessment_claim_id_invalid");
  if (!ASSESSMENT_STATUSES.has(candidate.assessment_status)) reasons.push("assessment_status_invalid");
  if (!ASSESSMENT_METHODS.has(candidate.assessment_method)) reasons.push("assessment_method_invalid");
  if (!ASSESSOR_TYPES.has(candidate.assessor_type)) reasons.push("assessor_type_invalid");
  if (!nonEmpty(candidate.assessor_id)) reasons.push("assessor_id_missing");

  const canonicalManifest = canonicalEvidenceManifest(candidate.evidence_manifest);
  if (!canonicalManifest) reasons.push("assessment_evidence_manifest_invalid");
  const derivedArtifactCount = canonicalManifest?.length ?? null;
  const derivedSourceCount = canonicalManifest
    ? new Set(canonicalManifest.map((entry) => entry.source_id)).size
    : null;
  const derivedEvidenceSetSha256 = canonicalManifest ? evidenceManifestSha256(canonicalManifest) : null;

  if (!SHA256_RE.test(String(candidate.evidence_set_sha256 ?? ""))) {
    reasons.push("assessment_evidence_set_sha256_invalid");
  } else if (derivedEvidenceSetSha256 && candidate.evidence_set_sha256.toLowerCase() !== derivedEvidenceSetSha256) {
    reasons.push("assessment_evidence_set_sha256_mismatch");
  }
  if (!positiveInteger(candidate.evidence_artifact_count)) {
    reasons.push("assessment_evidence_artifact_count_invalid");
  } else if (derivedArtifactCount !== null && candidate.evidence_artifact_count !== derivedArtifactCount) {
    reasons.push("assessment_evidence_artifact_count_mismatch");
  }
  if (!positiveInteger(candidate.independent_source_count)) {
    reasons.push("assessment_independent_source_count_invalid");
  } else if (derivedSourceCount !== null && candidate.independent_source_count !== derivedSourceCount) {
    reasons.push("assessment_independent_source_count_mismatch");
  }
  if (
    candidate.assessment_method === "independent_source_corroboration" &&
    derivedSourceCount !== null &&
    derivedSourceCount < 2
  ) {
    reasons.push("independent_corroboration_requires_multiple_sources");
  }

  const knowledgeTime = parseDate(candidate.assessment_knowledge_time);
  const assessedAt = parseDate(candidate.assessed_at);
  if (!knowledgeTime) reasons.push("assessment_knowledge_time_invalid");
  if (!assessedAt) reasons.push("assessed_at_invalid");
  if (knowledgeTime && assessedAt && knowledgeTime > assessedAt) reasons.push("assessment_knowledge_time_after_assessment");
  validateNullableConfidence(candidate.confidence, candidate.confidence_semantics, reasons, "assessment");
  return freezeResult({ admissible: reasons.length === 0, reasons });
}

export function evaluateVerifiedEvidenceBundle({ artifact, claim, link, assessment, cutoff_at = null } = {}) {
  const artifactResult = evaluateEvidenceArtifact(artifact);
  const claimResult = evaluateEvidenceClaim(claim);
  const linkResult = evaluateClaimArtifactLink(link);
  const assessmentResult = evaluateClaimAssessment(assessment);
  const reasons = [
    ...artifactResult.reasons,
    ...claimResult.reasons,
    ...linkResult.reasons,
    ...assessmentResult.reasons,
  ];

  if (!artifactResult.verified_external_evidence) reasons.push("artifact_not_verified_external_evidence");
  if (!isUuid(artifact?.id) || !isUuid(claim?.id)) reasons.push("bundle_record_ids_required");
  if (link?.artifact_id !== artifact?.id) reasons.push("link_artifact_mismatch");
  if (link?.claim_id !== claim?.id) reasons.push("link_claim_mismatch");
  if (!new Set(["source_of", "supports"]).has(link?.relationship)) reasons.push("link_does_not_support_claim");
  if (assessment?.claim_id !== claim?.id) reasons.push("assessment_claim_mismatch");

  const canonicalManifest = canonicalEvidenceManifest(assessment?.evidence_manifest);
  const assessmentContainsArtifact = canonicalManifest?.some((entry) =>
    entry.artifact_id === String(artifact?.id ?? "").toLowerCase() &&
    entry.artifact_sha256 === String(artifact?.artifact_sha256 ?? "").toLowerCase() &&
    entry.source_id === artifact?.source_id) ?? false;
  if (!assessmentContainsArtifact) reasons.push("assessment_evidence_set_missing_linked_artifact");

  if (claim?.synthetic === true) reasons.push("synthetic_claim_forbidden_for_verified_evidence");
  if (claim?.epistemic_status === "contradicted") reasons.push("contradicted_claim_forbidden_for_verified_evidence");
  if (assessment?.assessment_status !== "verified") reasons.push("claim_not_verified_by_assessment");
  if (["model_assisted", "rule_based"].includes(assessment?.assessment_method)) {
    reasons.push("automated_assessment_cannot_independently_verify_claim");
  }

  const cutoff = parseDate(cutoff_at);
  const artifactKnowledge = parseDate(artifact?.knowledge_time);
  const assessmentKnowledge = parseDate(assessment?.assessment_knowledge_time);
  if (cutoff_at !== null && !cutoff) reasons.push("cutoff_at_invalid");
  if (cutoff && artifactKnowledge && artifactKnowledge > cutoff) reasons.push("artifact_after_cutoff");
  if (cutoff && assessmentKnowledge && assessmentKnowledge > cutoff) reasons.push("assessment_after_cutoff");

  const uniqueReasons = [...new Set(reasons)];
  return freezeResult({
    admissible: artifactResult.admissible && claimResult.admissible && linkResult.admissible && assessmentResult.admissible,
    verified: uniqueReasons.length === 0,
    reasons: uniqueReasons,
  });
}

function validateNullableConfidence(value, semantics, reasons, prefix) {
  if (value === null || value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    reasons.push(`${prefix}_confidence_invalid`);
    return;
  }
  if (!hasUsableConfidenceSemantics(semantics)) reasons.push(`${prefix}_confidence_semantics_missing_or_unusable`);
}

function hasUsableConfidenceSemantics(value) {
  if (!nonEmpty(value)) return false;
  const normalized = value.toLowerCase();
  return !UNTRUSTED_CONFIDENCE_SEMANTICS.some((token) => normalized.includes(token));
}

function validateInterval(startValue, endValue, reasons, prefix) {
  if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) return;
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) {
    reasons.push(`${prefix}_invalid`);
    return;
  }
  if (end < start) reasons.push(`${prefix}_reversed`);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDate(value) {
  return parseDate(value) !== null;
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResult(reason) {
  return freezeResult({ admissible: false, verified_external_evidence: false, verified: false, reasons: [reason] });
}

function freezeResult(result) {
  const reasons = Object.freeze([...(result.reasons ?? [])]);
  return Object.freeze({ ...result, reasons });
}
