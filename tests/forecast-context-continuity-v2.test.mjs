import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/forecast/ForecastWorkspaceNav.tsx", import.meta.url);

test("Forecast mode changes preserve selected entity and investigation question", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /for \(const key of \["entity", "question"\]\)/);
  assert.match(source, /persistedForecastSearch\(location\.search\)/);
  assert.match(source, /navigateMode\(mode\.path\)/);
});

test("Forecast mode changes do not carry mode-specific filters across surfaces", async () => {
  const source = await readFile(navPath, "utf8");

  assert.doesNotMatch(source, /\["entity", "question", "horizon"\]/);
  assert.doesNotMatch(source, /\["entity", "question", "domain"\]/);
  assert.doesNotMatch(source, /navigate\(mode\.path\)/);
});

test("Forecast selected entity remains visible in the workspace nav", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /selectedEntity\?\.type === "forecast"/);
  assert.match(source, /forecast · \{selectedEntity\.name\}/);
});
