import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("../src/components/analysis/GovernedResearchPanel.tsx", import.meta.url);
const enginePath = new URL("../src/pages/IntelligenceEngine.tsx", import.meta.url);
const askPath = new URL("../src/components/aicis/intelligence/AskAICISPanel.tsx", import.meta.url);

test("Intelligence Engine mounts the governed evidence research surface", async () => {
  const source = await readFile(enginePath, "utf8");

  assert.match(source, /GovernedResearchPanel/);
  assert.match(source, /<GovernedResearchPanel \/>/);
});

test("Governed research uses the existing sovereign evidence endpoint", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /supabase\.functions\.invoke\(\s*"aicis-intelligence"/);
  assert.match(source, /searchParams\.get\("question"\)/);
  assert.match(source, /selectedEntity/);
  assert.match(source, /Selected intelligence context:/);
  assert.match(source, /Run evidence research/);
});

test("Research UI does not invent confidence, sources, freshness, or fallback answers", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.doesNotMatch(source, /confidence\s*:\s*75/);
  assert.doesNotMatch(source, /AICIS Core Intelligence/);
  assert.doesNotMatch(source, /DataFreshnessBadge/);
  assert.doesNotMatch(source, /VerificationScore/);
  assert.match(source, /confidence: finiteNumber\(response\.confidence\)/);
  assert.match(source, /sources: stringArray\(response\.sources\)/);
  assert.match(source, /No fallback answer was generated in the interface/);
});

test("Research distinguishes response generation time from evidence freshness", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /Response generated/);
  assert.doesNotMatch(source, /lastUpdated/);
  assert.doesNotMatch(source, /FRESHNESS/);
});

test("Ask AICIS describes the handoff as evidence research", async () => {
  const source = await readFile(askPath, "utf8");

  assert.match(source, /Continue in evidence research/);
  assert.match(source, /evidence-research workspace/);
  assert.doesNotMatch(source, /Open in full research/);
});


test("Zero evidence cannot be rendered as low severity", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /const evidenceCount = finiteNumber\(metadata\.evidence_count\)/);
  assert.match(source, /evidenceCount === 0 \? "unknown" : severityOf\(response\.severity\)/);
});
