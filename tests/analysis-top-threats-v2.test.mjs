import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const threatsPath = new URL("../src/components/analyst-dashboard/TopThreatsCard.tsx", import.meta.url);
const queriesPath = new URL("../src/components/analyst-dashboard/queries.ts", import.meta.url);

test("Analyst top threats come from the latest stored generation batch", async () => {
  const source = await readFile(queriesPath, "utf8");

  assert.match(source, /select\("generation_batch_id,generated_at"\)/);
  assert.match(source, /order\("generated_at", \{ ascending: false \}\)/);
  assert.match(source, /eq\("generation_batch_id", latest\.generation_batch_id\)/);
  assert.match(source, /evidence_count/);
  assert.match(source, /horizon_days/);
  assert.match(source, /model_version/);
  assert.doesNotMatch(source, /evidence_count: null as number \| null/);
});

test("Analyst top threats open as governed forecast entities", async () => {
  const source = await readFile(threatsPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.match(source, /type: "forecast"/);
  assert.match(source, /sourceCount: threat\.evidence_count/);
  assert.match(source, /horizonDays: threat\.horizon_days/);
  assert.match(source, /modelVersion: threat\.model_version/);
  assert.match(source, /batchId: threat\.generation_batch_id/);
  assert.doesNotMatch(source, /data: any\[\]/);
});
