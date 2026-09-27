import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/decisions/DecisionWorkspaceNav.tsx", import.meta.url);
const operationsPath = new URL("../src/pages/DecisionOperations.tsx", import.meta.url);

test("Decision workspace mode changes preserve entity and investigation context", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /for \(const key of \["entity", "question"\]\)/);
  assert.match(source, /persistedDecisionSearch\(location\.search\)/);
  assert.match(source, /navigateMode\(mode\.path\)/);
});

test("Decision operations tabs are URL-addressable", async () => {
  const source = await readFile(operationsPath, "utf8");

  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\("tab"\)/);
  assert.match(source, /next\.set\("tab", value\)/);
  assert.match(source, /<Tabs value=\{activeTab\} onValueChange=\{setActiveTab\}/);
});

test("Decision operations default view uses a clean URL and preserves other context", async () => {
  const source = await readFile(operationsPath, "utf8");

  assert.match(source, /if \(value === "today"\) next\.delete\("tab"\)/);
  assert.match(source, /new URLSearchParams\(searchParams\)/);
  assert.match(source, /setSearchParams\(next, \{ replace: true \}\)/);
});
