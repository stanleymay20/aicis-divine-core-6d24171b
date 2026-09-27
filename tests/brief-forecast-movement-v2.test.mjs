import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("../src/components/morning-brief/ForecastMovementPanel.tsx", import.meta.url);
const dashboardPath = new URL("../src/components/morning-brief/MorningBriefDashboard.tsx", import.meta.url);

test("Forecast movement compares stored batches rather than generating a new forecast", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /risk_ranking_predictions/);
  assert.match(source, /generation_batch_id/);
  assert.match(source, /previousProbability/);
  assert.match(source, /row\.risk_probability - previous\.risk_probability/);
  assert.doesNotMatch(source, /functions\.invoke\("predict-risk-ranking"/);
  assert.doesNotMatch(source, /Math\.random/);
});

test("Forecast movement abstains when two comparable batches do not exist", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /insufficient_history/);
  assert.match(source, /no_overlap/);
  assert.match(source, /No delta is being invented/);
});

test("Forecast movement objects open in the shared Intelligence Inspector", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.match(source, /type: "forecast"/);
  assert.match(source, /sourceCount: movement\.evidence_count/);
});

test("Brief reading order includes forecast movement before attention items", async () => {
  const source = await readFile(dashboardPath, "utf8");

  const matters = source.indexOf("Why it matters");
  const movement = source.indexOf("What became more or less likely");
  const attention = source.indexOf("What needs attention");

  assert.ok(matters >= 0);
  assert.ok(movement > matters);
  assert.ok(attention > movement);
  assert.match(source, /<ForecastMovementPanel \/>/);
});
