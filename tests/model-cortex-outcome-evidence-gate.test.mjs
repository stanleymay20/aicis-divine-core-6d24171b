import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const outcomePath = new URL("../supabase/functions/cognitive-model-outcome/index.ts", import.meta.url);
const promotePath = new URL("../supabase/functions/cognitive-model-promote/index.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/20260830183000_model_cortex_verified_outcome_gate_v1.sql",
  import.meta.url,
);

test("Model Cortex outcome metrics use the canonical verified evaluation read model", async () => {
  const source = await readFile(outcomePath, "utf8");

  assert.match(source, /aicis_verified_model_outcome_evaluations/);
  assert.match(source, /external_verified_target_resolution_v1/);
  assert.match(source, /externally_verified_target_resolution_probability_metrics_v3/);
  assert.match(source, /candidate_binary_outcome: candidateBinary/);
  assert.match(source, /binary_outcome: verifiedBinary/);
  assert.match(source, /verified_sample_size: pairs\.length/);
  assert.match(source, /\.eq\("domain", route\.domain\)/);
  assert.match(source, /\.eq\("modality", route\.modality\)/);

  // Regression guard for the previous defect: direct model/task aggregation from
  // caller-populated aicis_model_outcomes must not return as the evaluation path.
  assert.doesNotMatch(
    source,
    /aicis_model_outcomes!inner\(binary_outcome\)/,
  );
});

test("Model Cortex promotion requires the exact verified evidence contract", async () => {
  const source = await readFile(promotePath, "utf8");

  assert.match(source, /REQUIRED_EVALUATION_METHOD = "externally_verified_target_resolution_probability_metrics_v3"/);
  assert.match(source, /REQUIRED_EVIDENCE_POLICY = "external_verified_target_resolution_v1"/);
  assert.match(source, /REQUIRED_EVALUATION_SCOPE = "model_domain_modality_task"/);
  assert.match(source, /sample_size is not proven equal to verified_sample_size/);
  assert.match(source, /hasRecognizedVerifiedEvaluation/);
  assert.doesNotMatch(source, /hasUsableSemantics\(/);
});

test("database truth gate dynamically requires verified external evidence and target resolution", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /CREATE TABLE IF NOT EXISTS public\.aicis_model_outcome_resolutions/);
  assert.match(source, /resolution_status = 'verified'/);
  assert.match(source, /verification_status <> 'verified'/);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.enforce_aicis_model_outcome_truth_gate/);
  assert.match(source, /binary_outcome\/brier_score requires a verified target resolution/);
  assert.match(source, /CREATE VIEW public\.aicis_verified_model_outcome_evaluations/);
  assert.match(source, /e\.verification_status = 'verified'/);
  assert.match(source, /r\.resolved_binary_outcome = o\.binary_outcome/);
  assert.match(source, /legacy_outcome_not_verified_for_evaluation/);
});
