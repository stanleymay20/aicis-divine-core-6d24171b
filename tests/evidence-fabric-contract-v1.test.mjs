import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
  claimSha256,
  evidenceManifestSha256,
  evaluateClaimArtifactLink,
  evaluateClaimAssessment,
  evaluateEvidenceArtifact,
  evaluateEvidenceClaim,
  evaluateEvidenceTransformRun,
  evaluateVerifiedEvidenceBundle,
} from "../scripts/evidence-fabric-contract-v1.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const REVISION = "e".repeat(40);
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "11111111-1111-4111-8111-111111111111";
const TRANSFORM_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_ARTIFACT_ID = "44444444-4444-4444-8444-444444444444";

function artifact(overrides = {}) {
  return {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    id: ARTIFACT_ID,
    source_id: "example-source-record-1",
    source_class: "primary_official",
    artifact_sha256: SHA_A,
    retrieved_at: "2026-09-04T10:00:00Z",
    first_observed_at: "2026-09-04T10:00:00Z",
    published_at: "2026-09-04T08:00:00Z",
    knowledge_time: "2026-09-04T08:00:00Z",
    knowledge_time_status: "verified_leakage_safe",
    knowledge_time_verified_at: "2026-09-04T10:05:00Z",
    c2pa_status: "not_checked",
    synthetic: false,
    ...overrides,
  };
}

function claim(overrides = {}) {
  const candidate = {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    id: CLAIM_ID,
    claim_origin: "direct_source_record",
    statement: "The measured value was 42 units.",
    epistemic_status: "observed",
    confidence: null,
    confidence_semantics: null,
    synthetic: false,
    ...overrides,
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "claim_sha256")) {
    candidate.claim_sha256 = claimSha256(candidate);
  }
  return candidate;
}

function link(overrides = {}) {
  return {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    claim_id: CLAIM_ID,
    artifact_id: ARTIFACT_ID,
    relationship: "source_of",
    ...overrides,
  };
}

function manifestEntry(sourceArtifact = artifact(), overrides = {}) {
  return {
    artifact_id: sourceArtifact.id,
    artifact_sha256: sourceArtifact.artifact_sha256,
    source_id: sourceArtifact.source_id,
    ...overrides,
  };
}

function assessment(overrides = {}) {
  const evidenceManifest = Object.prototype.hasOwnProperty.call(overrides, "evidence_manifest")
    ? overrides.evidence_manifest
    : [manifestEntry()];
  const canonicalHash = evidenceManifestSha256(evidenceManifest);
  const sourceCount = Array.isArray(evidenceManifest)
    ? new Set(evidenceManifest.map((entry) => entry?.source_id).filter(Boolean)).size
    : 0;
  const candidate = {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    claim_id: CLAIM_ID,
    assessment_status: "verified",
    assessment_method: "direct_primary_source",
    assessor_type: "deterministic_system",
    assessor_id: "aicis-evidence-verifier-v1",
    evidence_manifest: evidenceManifest,
    evidence_set_sha256: canonicalHash,
    evidence_artifact_count: Array.isArray(evidenceManifest) ? evidenceManifest.length : 0,
    independent_source_count: sourceCount,
    assessment_knowledge_time: "2026-09-04T10:10:00Z",
    assessed_at: "2026-09-04T10:11:00Z",
    confidence: null,
    confidence_semantics: null,
    ...overrides,
  };
  if (
    Object.prototype.hasOwnProperty.call(overrides, "evidence_manifest") &&
    !Object.prototype.hasOwnProperty.call(overrides, "evidence_set_sha256")
  ) {
    candidate.evidence_set_sha256 = canonicalHash;
  }
  if (
    Object.prototype.hasOwnProperty.call(overrides, "evidence_manifest") &&
    !Object.prototype.hasOwnProperty.call(overrides, "evidence_artifact_count")
  ) {
    candidate.evidence_artifact_count = Array.isArray(evidenceManifest) ? evidenceManifest.length : 0;
  }
  if (
    Object.prototype.hasOwnProperty.call(overrides, "evidence_manifest") &&
    !Object.prototype.hasOwnProperty.call(overrides, "independent_source_count")
  ) {
    candidate.independent_source_count = sourceCount;
  }
  return candidate;
}

function transform(overrides = {}) {
  return {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    id: TRANSFORM_ID,
    transform_type: "deterministic_code",
    producer: "aicis-parser-v1",
    producer_version: "1.0.0",
    code_sha256: SHA_A,
    input_set_sha256: SHA_B,
    output_set_sha256: SHA_C,
    started_at: "2026-09-04T10:00:01Z",
    completed_at: "2026-09-04T10:00:02Z",
    synthetic_output: false,
    ...overrides,
  };
}

function verifiedBundle(overrides = {}) {
  const sourceArtifact = artifact(overrides.artifact ?? {});
  const evidenceClaim = claim(overrides.claim ?? {});
  const evidenceLink = link({
    claim_id: evidenceClaim.id,
    artifact_id: sourceArtifact.id,
    ...(overrides.link ?? {}),
  });
  const evidenceAssessment = assessment({
    claim_id: evidenceClaim.id,
    evidence_manifest: [manifestEntry(sourceArtifact)],
    ...(overrides.assessment ?? {}),
  });
  const bundle = {
    artifact: sourceArtifact,
    claim: evidenceClaim,
    link: evidenceLink,
    assessment: evidenceAssessment,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, "transform")) bundle.transform = overrides.transform;
  if (Object.prototype.hasOwnProperty.call(overrides, "cutoff_at")) bundle.cutoff_at = overrides.cutoff_at;
  return bundle;
}

test("verified external artifact requires immutable identity and leakage-safe knowledge time", () => {
  const result = evaluateEvidenceArtifact(artifact());
  assert.equal(result.admissible, true);
  assert.equal(result.verified_external_evidence, true);
  assert.deepEqual(result.reasons, []);
});

test("artifact synthetic flag is mandatory and synthetic artifacts cannot become verified external evidence", () => {
  const missingFlag = artifact();
  delete missingFlag.synthetic;
  const missing = evaluateEvidenceArtifact(missingFlag);
  assert.equal(missing.admissible, false);
  assert.ok(missing.reasons.includes("artifact_synthetic_flag_required"));

  const synthetic = evaluateEvidenceArtifact(artifact({ synthetic: true }));
  assert.equal(synthetic.admissible, true);
  assert.equal(synthetic.verified_external_evidence, false);
});

test("unverified knowledge time remains admissible metadata but is not verified evidence", () => {
  const candidate = artifact({
    knowledge_time: null,
    knowledge_time_status: "unverified",
    knowledge_time_verified_at: null,
  });
  const result = evaluateEvidenceArtifact(candidate);
  assert.equal(result.admissible, true);
  assert.equal(result.verified_external_evidence, false);
});

test("verified knowledge time fails closed when proof fields are absent or temporally impossible", () => {
  const missing = evaluateEvidenceArtifact(artifact({ knowledge_time: null, knowledge_time_verified_at: null }));
  assert.equal(missing.admissible, false);
  assert.ok(missing.reasons.includes("verified_knowledge_time_missing"));
  assert.ok(missing.reasons.includes("knowledge_time_verified_at_missing"));

  const future = evaluateEvidenceArtifact(artifact({ knowledge_time: "2026-09-04T12:00:00Z" }));
  assert.equal(future.admissible, false);
  assert.ok(future.reasons.includes("knowledge_time_after_retrieval"));
  assert.ok(future.reasons.includes("knowledge_time_after_first_observation"));

  const predatedProof = evaluateEvidenceArtifact(artifact({
    knowledge_time_verified_at: "2026-09-04T07:59:59Z",
  }));
  assert.equal(predatedProof.admissible, false);
  assert.ok(predatedProof.reasons.includes("knowledge_time_verification_precedes_knowledge_time"));
});

test("optional artifact timestamps fail closed when malformed", () => {
  for (const [field, reason] of [
    ["published_at", "published_at_invalid"],
    ["knowledge_time", "knowledge_time_invalid"],
    ["knowledge_time_verified_at", "knowledge_time_verified_at_invalid"],
    ["valid_time_start", "valid_time_start_invalid"],
    ["valid_time_end", "valid_time_end_invalid"],
  ]) {
    const candidate = artifact({ [field]: "not-a-date" });
    const result = evaluateEvidenceArtifact(candidate);
    assert.equal(result.admissible, false, field);
    assert.ok(result.reasons.includes(reason), field);
  }
});

test("legacy numeric trust fields are rejected instead of silently inherited", () => {
  for (const field of ["confidence", "quality_score", "reliability_score", "freshness_score"]) {
    const result = evaluateEvidenceArtifact(artifact({ [field]: 0.5 }));
    assert.equal(result.admissible, false, field);
    assert.ok(result.reasons.includes(`artifact_legacy_trust_field_forbidden:${field}`));
  }
});

test("C2PA verification proves manifest integrity only and requires its own digest", () => {
  const missingDigest = evaluateEvidenceArtifact(artifact({ c2pa_status: "manifest_verified" }));
  assert.equal(missingDigest.admissible, false);
  assert.ok(missingDigest.reasons.includes("verified_c2pa_manifest_digest_missing"));

  const integrityOnly = evaluateEvidenceArtifact(artifact({
    c2pa_status: "manifest_verified",
    c2pa_manifest_sha256: SHA_B,
    knowledge_time: null,
    knowledge_time_status: "unverified",
    knowledge_time_verified_at: null,
  }));
  assert.equal(integrityOnly.admissible, true);
  assert.equal(integrityOnly.verified_external_evidence, false);

  const invalidManifest = evaluateEvidenceArtifact(artifact({ c2pa_status: "manifest_invalid" }));
  assert.equal(invalidManifest.admissible, true);
  assert.equal(invalidManifest.verified_external_evidence, false);
});

test("claim SHA-256 is bound to canonical claim content", () => {
  const original = claim({
    object_value: { beta: 2, alpha: 1 },
    valid_from: "2026-09-04T08:00:00Z",
  });
  assert.equal(evaluateEvidenceClaim(original).admissible, true);

  const sameContentDifferentKeyOrder = claim({
    object_value: { alpha: 1, beta: 2 },
    valid_from: "2026-09-04T08:00:00.000Z",
  });
  assert.equal(original.claim_sha256, sameContentDifferentKeyOrder.claim_sha256);

  const tampered = { ...original, statement: "The measured value was 43 units." };
  const result = evaluateEvidenceClaim(tampered);
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("claim_sha256_content_mismatch"));
});

test("extracted and derived claims require an attributable transform run", () => {
  for (const origin of ["extracted", "derived"]) {
    const result = evaluateEvidenceClaim(claim({ claim_origin: origin }));
    assert.equal(result.admissible, false);
    assert.ok(result.reasons.includes("claim_transform_run_required"));
  }

  const withTransform = evaluateEvidenceClaim(claim({
    claim_origin: "extracted",
    transform_run_id: TRANSFORM_ID,
  }));
  assert.equal(withTransform.admissible, true);
});

test("transform runs fail closed unless their implementation identity is attributable", () => {
  assert.equal(evaluateEvidenceTransformRun(transform()).admissible, true);

  const missingCode = evaluateEvidenceTransformRun(transform({ code_sha256: null }));
  assert.equal(missingCode.admissible, false);
  assert.ok(missingCode.reasons.includes("transform_code_sha256_required"));

  const selfHosted = evaluateEvidenceTransformRun(transform({
    transform_type: "self_hosted_model",
    code_sha256: null,
    model_id: "Qwen/Qwen3.8-27B",
    model_revision: REVISION,
    model_artifact_lock_sha256: SHA_D,
    prompt_sha256: SHA_A,
  }));
  assert.equal(selfHosted.admissible, true);

  const weakSelfHosted = evaluateEvidenceTransformRun(transform({
    transform_type: "self_hosted_model",
    code_sha256: null,
    model_id: "Qwen/Qwen3.8-27B",
    model_revision: "main",
    model_artifact_lock_sha256: null,
    prompt_sha256: null,
  }));
  assert.equal(weakSelfHosted.admissible, false);
  assert.ok(weakSelfHosted.reasons.includes("self_hosted_model_revision_invalid"));
  assert.ok(weakSelfHosted.reasons.includes("self_hosted_model_artifact_lock_invalid"));
});

test("unknown confidence stays null and quantified confidence requires usable declared semantics", () => {
  assert.equal(evaluateEvidenceClaim(claim({ confidence: null })).admissible, true);

  for (const semantics of [null, "legacy confidence", "unknown", "unspecified", "not_quantified", "unverified score"]) {
    const result = evaluateEvidenceClaim(claim({ confidence: 0.8, confidence_semantics: semantics }));
    assert.equal(result.admissible, false, String(semantics));
    assert.ok(result.reasons.includes("claim_confidence_semantics_missing_or_unusable"));
  }

  const quantified = evaluateEvidenceClaim(claim({
    confidence: 0.8,
    confidence_semantics: "empirical_probability_from_named_calibration_protocol_v1",
  }));
  assert.equal(quantified.admissible, true);
});

test("claim-artifact relationship must be explicit and controlled", () => {
  assert.equal(evaluateClaimArtifactLink(link()).admissible, true);
  const invalid = evaluateClaimArtifactLink(link({ relationship: "proves" }));
  assert.equal(invalid.admissible, false);
  assert.ok(invalid.reasons.includes("link_relationship_invalid"));
});

test("assessment evidence-set hash and counts are derived from the exact evidence manifest", () => {
  const valid = assessment();
  assert.equal(evaluateClaimAssessment(valid).admissible, true);

  const tamperedHash = evaluateClaimAssessment(assessment({ evidence_set_sha256: SHA_D }));
  assert.equal(tamperedHash.admissible, false);
  assert.ok(tamperedHash.reasons.includes("assessment_evidence_set_sha256_mismatch"));

  const badArtifactCount = evaluateClaimAssessment(assessment({ evidence_artifact_count: 2 }));
  assert.equal(badArtifactCount.admissible, false);
  assert.ok(badArtifactCount.reasons.includes("assessment_evidence_artifact_count_mismatch"));

  const badSourceCount = evaluateClaimAssessment(assessment({ independent_source_count: 2 }));
  assert.equal(badSourceCount.admissible, false);
  assert.ok(badSourceCount.reasons.includes("assessment_independent_source_count_mismatch"));

  const duplicate = manifestEntry();
  const duplicateManifest = evaluateClaimAssessment(assessment({ evidence_manifest: [duplicate, duplicate] }));
  assert.equal(duplicateManifest.admissible, false);
  assert.ok(duplicateManifest.reasons.includes("assessment_evidence_manifest_invalid"));
});

test("assessment knowledge time must not postdate assessment", () => {
  const result = evaluateClaimAssessment(assessment({
    assessment_knowledge_time: "2026-09-04T11:00:00Z",
    assessed_at: "2026-09-04T10:59:00Z",
  }));
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("assessment_knowledge_time_after_assessment"));
});

test("independent-source corroboration requires a manifest with at least two distinct sources", () => {
  const tooFew = evaluateClaimAssessment(assessment({
    assessment_method: "independent_source_corroboration",
  }));
  assert.equal(tooFew.admissible, false);
  assert.ok(tooFew.reasons.includes("independent_corroboration_requires_multiple_sources"));

  const secondArtifact = artifact({
    id: SECOND_ARTIFACT_ID,
    artifact_sha256: SHA_D,
    source_id: "independent-source-record-2",
  });
  const manifest = [manifestEntry(), manifestEntry(secondArtifact)];
  const valid = evaluateClaimAssessment(assessment({
    assessment_method: "independent_source_corroboration",
    evidence_manifest: manifest,
  }));
  assert.equal(valid.admissible, true);
  assert.equal(valid.evidence_artifact_count, undefined);
});

test("automated assessments may assist but cannot independently create verified truth", () => {
  for (const assessment_method of ["model_assisted", "rule_based"]) {
    const result = evaluateVerifiedEvidenceBundle(verifiedBundle({
      assessment: {
        assessment_method,
        assessor_type: assessment_method === "model_assisted"
          ? "model_assisted_system"
          : "deterministic_system",
      },
    }));
    assert.equal(result.admissible, true, assessment_method);
    assert.equal(result.verified, false, assessment_method);
    assert.ok(result.reasons.includes("automated_assessment_cannot_independently_verify_claim"));
  }
});

test("verified evidence bundle requires source, claim, supporting link and independent assessment to agree", () => {
  const result = evaluateVerifiedEvidenceBundle(verifiedBundle({ cutoff_at: "2026-09-04T10:15:00Z" }));
  assert.equal(result.admissible, true);
  assert.equal(result.verified, true);
  assert.deepEqual(result.reasons, []);
});

test("verified bundle requires the assessment manifest to contain the exact linked artifact identity", () => {
  const unrelated = artifact({
    id: SECOND_ARTIFACT_ID,
    artifact_sha256: SHA_D,
    source_id: "independent-source-record-2",
  });
  const result = evaluateVerifiedEvidenceBundle(verifiedBundle({
    assessment: { evidence_manifest: [manifestEntry(unrelated)] },
  }));
  assert.equal(result.admissible, true);
  assert.equal(result.verified, false);
  assert.ok(result.reasons.includes("assessment_evidence_set_missing_linked_artifact"));
});

test("unrelated or non-supporting claim-artifact links cannot verify a claim", () => {
  const artifactMismatch = evaluateVerifiedEvidenceBundle(verifiedBundle({
    link: { artifact_id: SECOND_ARTIFACT_ID },
  }));
  assert.equal(artifactMismatch.verified, false);
  assert.ok(artifactMismatch.reasons.includes("link_artifact_mismatch"));

  const claimMismatch = evaluateVerifiedEvidenceBundle(verifiedBundle({
    link: { claim_id: "55555555-5555-4555-8555-555555555555" },
  }));
  assert.equal(claimMismatch.verified, false);
  assert.ok(claimMismatch.reasons.includes("link_claim_mismatch"));

  for (const relationship of ["contradicts", "mentions", "context"]) {
    const result = evaluateVerifiedEvidenceBundle(verifiedBundle({ link: { relationship } }));
    assert.equal(result.verified, false, relationship);
    assert.ok(result.reasons.includes("link_does_not_support_claim"));
  }
});

test("assessment must target the same claim as the evidence bundle", () => {
  const result = evaluateVerifiedEvidenceBundle(verifiedBundle({
    assessment: { claim_id: "66666666-6666-4666-8666-666666666666" },
  }));
  assert.equal(result.verified, false);
  assert.ok(result.reasons.includes("assessment_claim_mismatch"));
});

test("extracted claim verification requires the exact admitted transform and rejects synthetic transform output", () => {
  const extractedClaim = {
    claim_origin: "extracted",
    transform_run_id: TRANSFORM_ID,
  };
  const valid = evaluateVerifiedEvidenceBundle(verifiedBundle({
    claim: extractedClaim,
    transform: transform(),
  }));
  assert.equal(valid.admissible, true);
  assert.equal(valid.verified, true);

  const mismatched = evaluateVerifiedEvidenceBundle(verifiedBundle({
    claim: extractedClaim,
    transform: transform({ id: "77777777-7777-4777-8777-777777777777" }),
  }));
  assert.equal(mismatched.verified, false);
  assert.ok(mismatched.reasons.includes("claim_transform_run_mismatch"));

  const synthetic = evaluateVerifiedEvidenceBundle(verifiedBundle({
    claim: extractedClaim,
    transform: transform({ synthetic_output: true }),
  }));
  assert.equal(synthetic.verified, false);
  assert.ok(synthetic.reasons.includes("synthetic_transform_output_forbidden_for_verified_evidence"));
});

test("future knowledge relative to a historical cutoff is rejected", () => {
  const result = evaluateVerifiedEvidenceBundle(verifiedBundle({ cutoff_at: "2026-09-04T09:00:00Z" }));
  assert.equal(result.verified, false);
  assert.ok(result.reasons.includes("assessment_after_cutoff"));
});

test("synthetic, contradicted and internally derived evidence cannot become external verified truth", () => {
  const syntheticClaim = evaluateVerifiedEvidenceBundle(verifiedBundle({ claim: { synthetic: true } }));
  assert.equal(syntheticClaim.verified, false);
  assert.ok(syntheticClaim.reasons.includes("synthetic_claim_forbidden_for_verified_evidence"));

  const contradicted = evaluateVerifiedEvidenceBundle(verifiedBundle({
    claim: { epistemic_status: "contradicted" },
  }));
  assert.equal(contradicted.verified, false);
  assert.ok(contradicted.reasons.includes("contradicted_claim_forbidden_for_verified_evidence"));

  const internalArtifact = evaluateVerifiedEvidenceBundle(verifiedBundle({
    artifact: { source_class: "derived_internal" },
  }));
  assert.equal(internalArtifact.verified, false);
  assert.ok(internalArtifact.reasons.includes("artifact_not_verified_external_evidence"));
});

test("candidate SQL is additive, append-only and rejects legacy numeric trust defaults", () => {
  const sql = readFileSync("scripts/sql/aicis-evidence-fabric-v1.candidate.sql", "utf8");
  assert.match(sql, /CONTROLLED SCHEMA CANDIDATE ONLY/i);
  for (const table of [
    "aicis_evidence_artifacts_v1",
    "aicis_evidence_transform_runs_v1",
    "aicis_evidence_claims_v1",
    "aicis_evidence_claim_artifacts_v1",
    "aicis_evidence_claim_assessments_v1",
    "aicis_evidence_fact_lineage_v1",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"));
  }
  assert.match(sql, /v_aicis_legacy_provenance_unverified_v1/i);
  assert.match(sql, /WITH \(security_invoker = true\)/i);
  assert.match(sql, /NULL::numeric AS admissible_confidence/i);
  assert.match(sql, /NULL::numeric AS admissible_quality_score/i);
  assert.match(sql, /NULLS NOT DISTINCT/i);
  assert.match(sql, /evidence_manifest jsonb NOT NULL/i);
  assert.match(sql, /evidence_artifact_count = jsonb_array_length\(evidence_manifest\)/i);
  assert.match(sql, /independent_source_count >= 2/i);
  assert.match(sql, /aicis_evidence_append_only_v1/i);
  assert.doesNotMatch(sql, /confidence\s+numeric[^;\n]*DEFAULT\s+(?:0\.5|1(?:\.0)?)/i);
  assert.doesNotMatch(sql, /quality_score[^;\n]*DEFAULT\s+(?:0\.5|1(?:\.0)?)/i);
  assert.doesNotMatch(sql, /GRANT[^;]*(?:UPDATE|DELETE)[^;]*aicis_evidence_/i);
});
