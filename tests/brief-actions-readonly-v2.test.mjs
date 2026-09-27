import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionsPath = new URL("../src/components/morning-brief/ActionsAwaitingStrip.tsx", import.meta.url);

test("Brief action queue is read-only and delegates mutations to Decisions", async () => {
  const source = await readFile(actionsPath, "utf8");

  assert.doesNotMatch(source, /useMutation/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /execution_started_at/);
  assert.doesNotMatch(source, /execution_completed_at/);
  assert.doesNotMatch(source, /Action dismissed/);
  assert.match(source, /Brief is read-only/);
  assert.match(source, /Decisions workspace/);
});

test("Brief action rows can be inspected as decision entities", async () => {
  const source = await readFile(actionsPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.match(source, /type: "decision"/);
  assert.match(source, /executionBlocker/);
  assert.match(source, /evidenceQualityScore/);
});

test("Brief action rows preserve explicit navigation to governed Decisions", async () => {
  const source = await readFile(actionsPath, "utf8");

  assert.match(source, /\/decision-ops\?/);
  assert.match(source, /Open Decisions/);
  assert.match(source, /REVIEW OVERDUE/);
});
