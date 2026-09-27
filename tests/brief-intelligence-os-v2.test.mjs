import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("../src/components/morning-brief/PriorityDecisionsPanel.tsx", import.meta.url);
const dashboardPath = new URL("../src/components/morning-brief/MorningBriefDashboard.tsx", import.meta.url);

test("Brief priority signals use stored metrics instead of frontend-invented financial values", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.doesNotMatch(source, /estimateImpactValue/);
  assert.doesNotMatch(source, /estimateROI/);
  assert.doesNotMatch(source, /derivePrecedent/);
  assert.doesNotMatch(source, /Loss avoided/);
  assert.doesNotMatch(source, /return/);
  assert.match(source, /impact_score/);
  assert.match(source, /urgency_score/);
  assert.match(source, /confidence_score/);
  assert.match(source, /source_count/);
});

test("Brief priority signals expose evidence context and shared inspector selection", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.match(source, /type: "signal"/);
  assert.match(source, /source_trust_tier/);
  assert.match(source, /primary_source/);
  assert.match(source, /uncertainty_notes/);
  assert.match(source, /Inspect signal/);
});

test("Brief does not mark a proposed action as executed from the briefing surface", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.doesNotMatch(source, /action_taken:\s*true/);
  assert.doesNotMatch(source, /Execute This Action/);
  assert.match(source, /not recorded as executed from the brief/);
  assert.match(source, /Open in Decisions/);
});

test("Morning Brief names the section as priority signals", async () => {
  const source = await readFile(dashboardPath, "utf8");

  assert.match(source, />Priority Signals</);
  assert.match(source, /stored evidence, uncertainty, and proposed actions/);
});
