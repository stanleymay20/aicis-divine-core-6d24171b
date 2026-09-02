import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";

const EXPECTED_SHA256 = "a7ed80a54d37b271dcd6b7a2d08f82009095785db5648f12e76d45eec79517aa";
const MIGRATION_PATH = new URL(
  "../supabase/migrations/20260902043532_forecast_task_registry_ledgers_v1.sql",
  import.meta.url,
);
const BASE_PATH = new URL(
  "../scripts/sql/forecast-task-registry-ledgers-v1.candidate.sql",
  import.meta.url,
);
const HARDENING_PATH = new URL(
  "../scripts/sql/forecast-task-registry-ledgers-v1.hardening.sql",
  import.meta.url,
);
const PROOF_PATH = new URL(
  "../migration/target/forecast-ledger-migration-generation-proof-v1.json",
  import.meta.url,
);
const TEMP_WORKFLOW_PATH = new URL(
  "../.github/workflows/forecast-ledger-migration-generation-proof.yml",
  import.meta.url,
);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("CLI-generated migration is byte-identical to the reviewed ordered schema bundle", async () => {
  const [base, hardening, migration] = await Promise.all([
    readFile(BASE_PATH),
    readFile(HARDENING_PATH),
    readFile(MIGRATION_PATH),
  ]);

  const orderedBundle = Buffer.concat([base, hardening]);
  assert.equal(Buffer.compare(migration, orderedBundle), 0);
  assert.equal(sha256(orderedBundle), EXPECTED_SHA256);
  assert.equal(sha256(migration), EXPECTED_SHA256);
});

test("migration provenance binds the exact CLI version, run, path and digest", async () => {
  const proof = JSON.parse(await readFile(PROOF_PATH, "utf8"));
  assert.equal(proof.schema, "aicis.forecast_ledger_migration_generation_proof.v1");
  assert.equal(proof.status, "generated_not_deployed");
  assert.equal(proof.supabase_cli.version, "2.116.0");
  assert.equal(proof.generation_evidence.github_actions_run_id, 33591371472);
  assert.equal(proof.generation_evidence.artifact_id, 9831851816);
  assert.equal(
    proof.migration.path,
    "supabase/migrations/20260902043532_forecast_task_registry_ledgers_v1.sql",
  );
  assert.equal(proof.source_bundle_sha256, EXPECTED_SHA256);
  assert.equal(proof.migration.sha256, EXPECTED_SHA256);
  assert.equal(proof.migration.byte_identical_to_source_bundle, true);
  assert.equal(proof.deployment.applied_to_supabase, false);
  assert.equal(proof.deployment.applied_to_aicis_production, false);
  assert.equal(proof.deployment.production_writers_enabled, false);
});

test("temporary migration-generation workflow is not retained", async () => {
  await assert.rejects(access(TEMP_WORKFLOW_PATH));
});
