import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const radarPath = new URL("../src/pages/OpportunityRadar.tsx", import.meta.url);
const hypothesesPath = new URL("../src/components/opportunities/OpportunityHypothesesPanel.tsx", import.meta.url);

test("Opportunity research queue remains signal context with provenance", async () => {
  const source = await readFile(radarPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /type: "signal"/);
  assert.match(source, /sourceCount: signal\?\.source_count/);
  assert.match(source, /primary_source/);
  assert.match(source, /source_trust_tier/);
  assert.match(source, /uncertaintyNotes/);
  assert.match(source, /impactReasoning/);
  assert.match(source, /Inspect/);
});

test("Product hypotheses are opportunity entities but remain explicitly research-only", async () => {
  const source = await readFile(hypothesesPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /type: "opportunity"/);
  assert.match(source, /Research hypothesis derived from/);
  assert.match(source, /Profitability remains unknown/);
  assert.match(source, /epistemicStatus/);
  assert.match(source, /profitabilityStatus/);
  assert.match(source, /guardrail/);
  assert.match(source, /Inspect hypothesis/);
});

test("Hypothesis inspection does not invent probability, profit, or confidence", async () => {
  const source = await readFile(hypothesesPath, "utf8");

  assert.doesNotMatch(source, /confidence:/);
  assert.doesNotMatch(source, /expectedProfit/);
  assert.doesNotMatch(source, /probability:/);
});
