import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/forecast/ForecastWorkspaceNav.tsx", import.meta.url);
const validationPath = new URL("../src/pages/ForecastValidation.tsx", import.meta.url);
const predictionsPath = new URL("../src/pages/Predictions.tsx", import.meta.url);
const simulationPath = new URL("../src/pages/Simulation.tsx", import.meta.url);
const outcomePath = new URL("../src/pages/OutcomeCockpit.tsx", import.meta.url);
const learningPath = new URL("../src/pages/LearningIntelligence.tsx", import.meta.url);
const loopPath = new URL("../src/pages/LearningLoop.tsx", import.meta.url);

test("Forecast workspace exposes validation, predictions, scenarios, outcomes, and learning", async () => {
  const nav = await readFile(navPath, "utf8");

  for (const label of ["Validation", "Predictions", "Scenarios", "Outcomes", "Learning"]) {
    assert.match(nav, new RegExp(`label: "${label}"`));
  }

  assert.match(nav, /requiredTier: "sovereign"/);
  assert.match(nav, /useIntelligenceOS/);
});

test("Primary forecast surfaces render the shared workspace navigation", async () => {
  for (const path of [validationPath, predictionsPath, simulationPath, outcomePath, learningPath, loopPath]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /ForecastWorkspaceNav/);
    assert.match(source, /<ForecastWorkspaceNav \/>/);
  }
});

test("Prediction rows open forecast entities while preserving declared semantics", async () => {
  const source = await readFile(predictionsPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.match(source, /type: "forecast"/);
  assert.match(source, /semantics: semanticsLabel\(row\)/);
  assert.match(source, /calibrationStatus/);
  assert.match(source, /empiricalIntervalLower/);
  assert.match(source, /modelSemantics: modelSemanticsLabel/);
  assert.match(source, /Inspect/);
});
