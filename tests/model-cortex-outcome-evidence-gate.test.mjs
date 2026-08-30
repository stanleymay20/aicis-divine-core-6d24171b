import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outcomePath = new URL("../supabase/functions/cognitive-model-outcome/index.ts", import.meta.url);
const promotePath = new URL("../supabase/functions/cognitive-model-promote/index.ts", import.meta.url);
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
