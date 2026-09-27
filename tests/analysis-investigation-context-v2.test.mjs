import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/analysis/AnalysisWorkspaceNav.tsx", import.meta.url);

test("Analysis investigation question is URL-backed and refresh-safe", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /new URLSearchParams\(location\.search\)/);
  assert.match(source, /next\.set\("question", question\)/);
  assert.match(source, /next\.delete\("question"\)/);
  assert.match(source, /Active investigation/);
});

test("Analysis mode changes preserve only entity and investigation question", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /for \(const key of \["entity", "question"\]\)/);
  assert.match(source, /persistedSearch\(location\.search\)/);
  assert.doesNotMatch(source, /\["entity", "question", "layer"\]/);
});

test("Analysis question can be committed by Enter and cleared explicitly", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /commitQuestion\(\)/);
  assert.match(source, /clearQuestion/);
  assert.match(source, /Clear investigation question/);
});
