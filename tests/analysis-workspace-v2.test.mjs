import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const analystPath = new URL("../src/pages/AnalystDashboard.tsx", import.meta.url);
const enginePath = new URL("../src/pages/IntelligenceEngine.tsx", import.meta.url);
const navPath = new URL("../src/components/analysis/AnalysisWorkspaceNav.tsx", import.meta.url);

test("Analyst overview does not create a nested AICIS application shell", async () => {
  const source = await readFile(analystPath, "utf8");

  assert.doesNotMatch(source, /AICISLayout/);
  assert.match(source, /<AnalysisWorkspaceNav \/>/);
  assert.match(source, /Analysis Overview/);
});

test("Cognitive core uses the same Analysis workspace navigation", async () => {
  const source = await readFile(enginePath, "utf8");

  assert.match(source, /AnalysisWorkspaceNav/);
  assert.match(source, /<AnalysisWorkspaceNav \/>/);
});

test("Analysis workspace nav consolidates overview, cognitive, graph and geography modes", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /"\/analyst"/);
  assert.match(source, /"\/intelligence-engine"/);
  assert.match(source, /"\/planetary-graph"/);
  assert.match(source, /"\/resolution"/);
  assert.match(source, /Analysis workspace/);
});

test("Analysis workspace nav carries selected intelligence context into Ask AICIS", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectedEntity/);
  assert.match(source, /openAsk/);
  assert.match(source, /Ask about selection/);
});
