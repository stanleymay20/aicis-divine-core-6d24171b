import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outcomePath = new URL("../supabase/functions/cognitive-model-outcome/index.ts", import.meta.url);
const promotePath = new URL("../supabase/functions/cognitive-model-promote/index.ts", import.meta.url);
const governPath = new URL("../supabase/functions/cognitive-model-evidence-govern/index.ts", import.meta.url);
const gateV1Path = new URL(
  "../supabase/migrations/20260830183000_model_cortex_verified_outcome_gate_v1.sql",
  import.meta.url,
);
const evidenceV2Path = new URL(
  "../supabase/migrations/20260830190000_model_cortex_evidence_integrity_v2.sql",
  import.meta.url,
);
const promotionV3Path = new URL(
  "../supabase/migrations/20260830193000_model_cortex_atomic_promotion_v3.sql",
  import.meta.url,
);
const artifactV4Path = new URL(
  "../supabase/migrations/20260830200000_model_cortex_evidence_artifact_binding_v4.sql",
  import.meta.url,
);
const metricsV5Path = new URL(
  "../supabase/migrations/20260830201000_model_cortex_metrics_artifact_contract_v5.sql",
  import.meta.url,
);
const targetV6Path = new URL(
  "../supabase/migrations/20260830202000_model_cortex_server_sealed_target_v6.sql",
  import.meta.url,
);
const writersV7Path = new URL(
  "../supabase/migrations/20260830210000_model_cortex_governed_evidence_writers_v7.sql",
  import.meta.url,
);
const rolesV8Path = new URL(
  "../supabase/migrations/20260830211000_model_cortex_evidence_workflow_roles_v8.sql",
  import.meta.url,
);
const separationV9Path = new URL(
  "../supabase/migrations/20260830212000_model_cortex_database_enforced_separation_v9.sql",
  import.meta.url,
);

test("Model Cortex outcome path uses sealed evidence and full-population database metrics", async () => {
  const source = await readFile(outcomePath, "utf8");

  assert.match(source, /aicis_model_prediction_target_contracts/);
  assert.match(source, /aicis_probability_semantics_evaluation_eligible/);
  assert.match(source, /refresh_aicis_model_cortex_competency_v4/);
  assert.match(source, /candidate_binary_outcome: candidateBinary/);
  assert.match(source, /binary_outcome: verifiedBinary/);
  assert.match(source, /external_verified_target_resolution_v2_sealed_knowledge_time/);
  assert.match(source, /population_truncated: false/);
  assert.doesNotMatch(source, /\.limit\(5000\)/);
  assert.doesNotMatch(source, /function isProbabilitySemantics/);
  assert.doesNotMatch(source, /aicis_model_outcomes!inner\(binary_outcome\)/);
});

test("promotion edge function delegates authority to the atomic governed database primitive", async () => {
  const source = await readFile(promotePath, "utf8");

  assert.match(source, /promote_aicis_model_cortex_atomic_v4/);
  assert.match(source, /validateTighteningOnlyInputs/);
  assert.doesNotMatch(source, /high_consequence\?:/);
  assert.doesNotMatch(source, /\.from\("aicis_model_registry"\)\s*\.update/);
  assert.doesNotMatch(source, /aicis_model_competency/);
  assert.doesNotMatch(source, /event_type: promoted/);
});

test("database truth gate requires verified external evidence and target resolution", async () => {
  const source = await readFile(gateV1Path, "utf8");

  assert.match(source, /CREATE TABLE IF NOT EXISTS public\.aicis_model_outcome_resolutions/);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.enforce_aicis_model_outcome_truth_gate/);
  assert.match(source, /binary_outcome\/brier_score requires a verified target resolution/);
  assert.match(source, /legacy_outcome_not_verified_for_evaluation/);
});

test("evidence integrity v2 seals target identity and knowledge-time chronology", async () => {
  const source = await readFile(evidenceV2Path, "utf8");

  assert.match(source, /aicis_model_prediction_target_contracts/);
  assert.match(source, /target_fingerprint_sha256/);
  assert.match(source, /sealed Model Cortex target contracts are immutable/);
  assert.match(source, /ADD COLUMN IF NOT EXISTS retrieved_at timestamptz/);
  assert.match(source, /verified external evidence truth-bearing fields are immutable/);
  assert.match(source, /evaluation evidence must be observed and learned after prediction issuance/);
  assert.match(source, /e\.retrieved_at >= c\.issued_at/);
});

test("atomic promotion v3 cannot use cached or truncated evidence and cannot weaken governance", async () => {
  const source = await readFile(promotionV3Path, "utf8");

  assert.match(source, /aicis_model_promotion_policies/);
  assert.match(source, /no active governed promotion policy exists for exact scope/);
  assert.match(source, /requested Brier threshold may not weaken governed policy floor/);
  assert.match(source, /requested calibration tolerance may not weaken governed policy floor/);
  assert.match(source, /aicis_model_cortex_scope_metrics_v4/);
  assert.match(source, /evidence_set_sha256/);
  assert.match(source, /population_truncated', false/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /INSERT INTO public\.aicis_cognitive_events/);
  assert.match(source, /Any audit failure rolls the entire promotion back/);
  assert.doesNotMatch(source, /LIMIT 5000/i);
});

test("canonical evidence artifacts are server-hashed, immutable, and required by the truth gate", async () => {
  const source = await readFile(artifactV4Path, "utf8");

  assert.match(source, /CREATE TABLE IF NOT EXISTS public\.aicis_prediction_evidence_artifacts/);
  assert.match(source, /aicis_prediction_evidence_artifact_sha256/);
  assert.match(source, /server-recomputed canonical evidence hash/);
  assert.match(source, /canonical prediction evidence artifacts are immutable/);
  assert.match(source, /evidence_artifact_id uuid/);
  assert.match(source, /canonical-artifact-v1/);
  assert.match(source, /evidence_sha256 does not match server-recomputed canonical artifact hash/);
  assert.match(source, /externally_verified_target_resolution_v2_canonical_artifact/);
  assert.match(source, /JOIN public\.aicis_prediction_evidence_artifacts a/);
  assert.match(source, /e\.evidence_sha256 = a\.artifact_sha256/);
});

test("full-population metrics fingerprint the canonical evidence artifact binding", async () => {
  const source = await readFile(metricsV5Path, "utf8");

  assert.match(source, /external_evidence_artifact_id/);
  assert.match(source, /evidence_binding_version/);
  assert.match(source, /external_verified_target_resolution_v3_canonical_artifact/);
  assert.match(source, /v5_full_population_artifact_bound/);
  assert.match(source, /canonical_artifact_binding_required', true/);
  assert.match(source, /population_truncated', false/);
  assert.doesNotMatch(source, /LIMIT 5000/i);
});

test("target contract issuance time and fingerprint are server-authoritative", async () => {
  const source = await readFile(targetV6Path, "utf8");

  assert.match(source, /v_now := clock_timestamp\(\)/);
  assert.match(source, /NEW\.issued_at := v_now/);
  assert.match(source, /NEW\.created_at := v_now/);
  assert.match(source, /NEW\.target_fingerprint_sha256 := public\.aicis_model_target_fingerprint/);
  assert.match(source, /caller must not be able to backdate issued_at/i);
  assert.match(source, /forecast_horizon_at cannot precede server-sealed issuance time/);
});

test("governed v7 writers establish server-authoritative evidence lifecycle", async () => {
  const source = await readFile(writersV7Path, "utf8");

  assert.match(source, /seal_aicis_model_prediction_target_v7/);
  assert.match(source, /create_aicis_prediction_evidence_artifact_v7/);
  assert.match(source, /record_aicis_model_external_evidence_v7/);
  assert.match(source, /verify_aicis_model_external_evidence_v7/);
  assert.match(source, /resolve_aicis_model_outcome_v7/);
  assert.match(source, /p_observed_at < v_contract\.issued_at/);
  assert.match(source, /v_artifact\.artifact_sha256/);
  assert.match(source, /verification_status = 'verified'/);
  assert.match(source, /v_contract\.target_definition/);
  assert.match(source, /TO service_role/);
  assert.doesNotMatch(source, /GRANT EXECUTE[\s\S]{0,200}TO authenticated/);
});

test("evidence workflow roles enforce separation of duties and grant nobody by migration", async () => {
  const source = await readFile(rolesV8Path, "utf8");

  assert.match(source, /aicis_model_evidence_workflow_roles/);
  assert.match(source, /evidence_verifier/);
  assert.match(source, /outcome_resolver/);
  assert.match(source, /one user cannot simultaneously hold evidence_verifier and outcome_resolver/);
  assert.match(source, /aicis_user_has_model_evidence_workflow_role_v7/);
  assert.doesNotMatch(source, /INSERT INTO public\.aicis_model_evidence_workflow_roles/);
  assert.doesNotMatch(source, /GRANT .* TO authenticated/);
});

test("database v9 prevents service-role bypass of verifier and resolver roles", async () => {
  const source = await readFile(separationV9Path, "utf8");

  assert.match(source, /REVOKE EXECUTE ON FUNCTION public\.verify_aicis_model_external_evidence_v7/);
  assert.match(source, /REVOKE EXECUTE ON FUNCTION public\.resolve_aicis_model_outcome_v7/);
  assert.match(source, /verify_aicis_model_external_evidence_v9/);
  assert.match(source, /resolve_aicis_model_outcome_v9/);
  assert.match(source, /evidence_verifier/);
  assert.match(source, /outcome_resolver/);
  assert.match(source, /p_actor_user_id/);
  assert.match(source, /v_resolver := 'admin-user:' \|\| p_actor_user_id::text/);
});

test("evidence governance edge derives actor identity and delegates to role-enforced RPCs", async () => {
  const source = await readFile(governPath, "utf8");

  assert.match(source, /requireAdminUser/);
  assert.match(source, /aicis_user_has_model_evidence_workflow_role_v7/);
  assert.match(source, /evidence_verifier/);
  assert.match(source, /outcome_resolver/);
  assert.match(source, /seal_aicis_model_prediction_target_v7/);
  assert.match(source, /create_aicis_prediction_evidence_artifact_v7/);
  assert.match(source, /record_aicis_model_external_evidence_v7/);
  assert.match(source, /verify_aicis_model_external_evidence_v9/);
  assert.match(source, /resolve_aicis_model_outcome_v9/);
  assert.match(source, /p_actor_user_id: auth\.user\.id/);
  assert.doesNotMatch(source, /p_resolver:/);
});
