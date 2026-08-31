import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260830213000_ml_training_knowledge_time_truth_floor_v3.sql",
  import.meta.url,
);
const exporterPath = new URL("../supabase/functions/export-aicis-dataset/index.ts", import.meta.url);
const inferencePath = new URL("../supabase/functions/run-ml-inference/index.ts", import.meta.url);

test("historical ML rows fail closed without governed knowledge-time proof", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /historical_cutoff_at timestamptz/);
  assert.match(source, /knowledge_time_status text NOT NULL DEFAULT 'unverified'/);
  assert.match(source, /verified_leakage_safe/);
  assert.match(source, /knowledge_time_proof_sha256/);
  assert.match(source, /ml_training_rows_knowledge_time_eligible_v3/);
  assert.match(source, /snapshot_date alone is insufficient/i);
  assert.match(source, /enforce_ml_manifest_knowledge_time_truth_v3/);
  assert.match(source, /training row % has no governed historical knowledge-time proof/);
  assert.match(source, /NEW\.knowledge_time_proof_sha256 := v_source\.knowledge_time_proof_sha256/);
  assert.doesNotMatch(source, /SET knowledge_time_status = 'verified_leakage_safe'/);
});

test("training export and inference use the same source-controlled country/date contract", async () => {
  const exporter = await readFile(exporterPath, "utf8");
  const inference = await readFile(inferencePath, "utf8");

  assert.match(exporter, /training_dataset:[\s\S]*iso3Col: "country_iso3"/);
  assert.match(exporter, /training_dataset:[\s\S]*dateCol: "snapshot_date"/);
  assert.match(exporter, /knowledge_time_requires_governed_lineage_proof/);
  assert.match(inference, /country_iso3: string \| null/);
  assert.match(inference, /snapshot_date: string \| null/);
  assert.doesNotMatch(exporter, /training_dataset:[\s\S]*iso3Col: "iso3"/);
  assert.doesNotMatch(exporter, /training_dataset:[\s\S]*dateCol: "feature_window_end"/);
});
