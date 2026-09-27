import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const aliasPages = [
  "../src/pages/TrainingDataset.tsx",
  "../src/pages/Accumulation.tsx",
  "../src/pages/PilotTruthFeed.tsx",
];

test("Data and Trust aliases render the shared workspace navigation", async () => {
  for (const relativePath of aliasPages) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /DataTrustWorkspaceNav/);
    assert.match(source, /<DataTrustWorkspaceNav \/>/);
  }
});

test("Pilot Truth no longer relies on explicit any for ungenerated view types", async () => {
  const source = await readFile(
    new URL("../src/pages/PilotTruthFeed.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\bas any\b/);
  assert.doesNotMatch(source, /Map<string, any>/);
  assert.match(source, /pilot_truth_feed" as never/);
  assert.match(source, /EvidenceBadgeRow/);
});

test("Data Integrity avoids explicit any for its snapshot view", async () => {
  const source = await readFile(
    new URL("../src/pages/DataIntegrity.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /v_data_integrity_snapshot" as any/);
  assert.match(source, /v_data_integrity_snapshot" as never/);
});
