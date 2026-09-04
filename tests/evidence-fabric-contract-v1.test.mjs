import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
  evaluateClaimAssessment,
  evaluateEvidenceArtifact,
  evaluateEvidenceClaim,
  evaluateVerifiedEvidenceBundle,
} from "../scripts/evidence-fabric-contract-v1.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const UUID = "11111111-1111-4111-8111-111111111111";

function artifact(overrides = {}) {
  return {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
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
  return {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    claim_origin: "direct_source_record",
    statement: "The measured value was 42 units.",
    claim_sha256: SHA_B,
    epistemic_status: "observed",
    confidence: null,
    confidence_semantics: null,
    synthetic: false,
    ...overrides,
  };
}

function assessment(overrides = {}) {
  return {
    contract_version: AICIS_EVIDENCE_FABRIC_CONTRACT_VERSION,
    claim_id: UUID,
    assessment_status: "verified",
    assessment_method: "direct_primary_source",
    assessor_type: "deterministic_system",
    assessor_id: "aicis-evidence-verifier-v1",
    evidence_set_sha256: SHA_C,
    assessment_knowledge_time: "2026-09-04T10:10:00Z",
    assessed_at: "2026-09-04T10:11:00Z",
    confidence: null,
    confidence_semantics: null,
    ...overrides,
  };
}

test("verified external artifact requires immutable identity and leakage-safe knowledge time", () => {
  const result = evaluateEvidenceArtifact(artifact());
  assert.equal(result.admissible, true);
  assert.equal(result.verified_external_evidence, true);
  assert.deepEqual(result.reasons, []);
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
});

test("extracted and derived claims require an attributable transform run", () => {
  for (const origin of ["extracted", "derived"]) {
    const result = evaluateEvidenceClaim(claim({ claim_origin: origin }));
    assert.equal(result.admissible, false);
    assert.ok(result.reasons.includes("claim_transform_run_required"));
  }

  const withTransform = evaluateEvidenceClaim(claim({ claim_origin: "extracted", transform_run_id: UUID }));
  assert.equal(withTransform.admissible, true);
});

test("unknown confidence stays null and quantified confidence requires declared semantics", () => {
  assert.equal(evaluateEvidenceClaim(claim({ confidence: null })).admissible, true);

  const missingSemantics = evaluateEvidenceClaim(claim({ confidence: 0.8, confidence_semantics: null }));
  assert.equal(missingSemantics.admissible, false);
  assert.ok(missingSemantics.reasons.includes("claim_confidence_semantics_missing"));

  const quantified = evaluateEvidenceClaim(claim({
    confidence: 0.8,
    confidence_semantics: "empirical_probability_from_named_calibration_protocol_v1",
  }));
  assert.equal(quantified.admissible, true);
});

test("assessment knowledge time must not postdate assessment", () => {
  const result = evaluateClaimAssessment(assessment({
    assessment_knowledge_time: "2026-09-04T11:00:00Z",
    assessed_at: "2026-09-04T10:59:00Z",
  }));
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("assessment_knowledge_time_after_assessment"));
});

test("a model-assisted assessment cannot independently create verified truth", () => {
  const result = evaluateVerifiedEvidenceBundle({
    artifact: artifact(),
    claim: claim(),
    assessment: assessment({
      assessment_method: "model_assisted",
      assessor_type: "model_assisted_system",
    }),
  });
  assert.equal(result.admissible, true);
  assert.equal(result.verified, false);
  assert.ok(result.reasons.includes("model_assisted_assessment_cannot_independently_verify_claim"));
});

test("verified evidence bundle passes only when source, claim and independent assessment all pass", () => {
  const result = evaluateVerifiedEvidenceBundle({
    artifact: artifact(),
    claim: claim(),
    assessment: assessment(),
    cutoff_at: "2026-09-04T10:15:00Z",
  });
  assert.equal(result.admissible, true);
  assert.equal(result.verified, true);
  assert.deepEqual(result.reasons, []);
});

test("future knowledge relative to a historical cutoff is rejected", () => {
  const result = evaluateVerifiedEvidenceBundle({
    artifact: artifact(),
    claim: claim(),
    assessment: assessment(),
    cutoff_at: "2026-09-04T09:00:00Z",
  });
  assert.equal(result.verified, false);
  assert.ok(result.reasons.includes("assessment_after_cutoff"));
});

test("synthetic claims and internally derived artifacts cannot become external verified evidence", () => {
  const syntheticClaim = evaluateVerifiedEvidenceBundle({
    artifact: artifact(),
    claim: claim({ synthetic: true }),
    assessment: assessment(),
  });
  assert.equal(syntheticClaim.verified, false);
  assert.ok(syntheticClaim.reasons.includes("synthetic_claim_forbidden_for_verified_evidence"));

  const internalArtifact = evaluateVerifiedEvidenceBundle({
    artifact: artifact({ source_class: "derived_internal" }),
    claim: claim(),
    assessment: assessment(),
  });
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
  assert.match(sql, /NULL::numeric AS admissible_confidence/i);
  assert.match(sql, /NULL::numeric AS admissible_quality_score/i);
  assert.match(sql, /aicis_evidence_append_only_v1/i);
  assert.doesNotMatch(sql, /confidence\s+numeric[^;\n]*DEFAULT\s+(?:0\.5|1(?:\.0)?)/i);
  assert.doesNotMatch(sql, /quality_score[^;\n]*DEFAULT\s+(?:0\.5|1(?:\.0)?)/i);
  assert.doesNotMatch(sql, /GRANT[^;]*(?:UPDATE|DELETE)[^;]*aicis_evidence_/i);
  assert.doesNotMatch(sql, /supabase\/migrations/i);
});
