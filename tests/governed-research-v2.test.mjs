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

test("Governed research invokes orchestrate-multi-agent, not aicis-intelligence", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /supabase\.functions\.invoke\("orchestrate-multi-agent"/);
  assert.doesNotMatch(source, /aicis-intelligence/);
  assert.match(source, /searchParams\.get\("question"\)/);
  assert.match(source, /selectedEntity/);
});

test("Carried question auto-runs once and confidence is labelled as not calibrated", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /autoRanFor\.current !== activeQuestion/);
  assert.match(source, /not a calibrated probability/);
  assert.match(source, /No fallback answer was generated in the interface/);
  assert.match(source, /What AICIS cannot conclude/);
  assert.match(source, /priorTurn\?\.followUpSupported/);
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


