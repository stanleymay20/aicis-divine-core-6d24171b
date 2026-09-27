import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const forecastPath = new URL("../src/pages/ForecastValidation.tsx", import.meta.url);

test("Forecast validation keeps navigation visible during loading", async () => {
  const source = await readFile(forecastPath, "utf8");

  assert.match(source, /if \(isLoading\)/);
  assert.match(source, /<ForecastWorkspaceNav \/>/);
  assert.match(source, /Loading prospective forecast validation/);
});

test("Forecast validation does not translate query failure into awaiting data", async () => {
  const source = await readFile(forecastPath, "utf8");

  assert.match(source, /isError/);
  assert.match(source, /Forecast validation unavailable/);
  assert.match(source, /not treating\s+this state as awaiting data/);
  assert.match(source, /role="alert"/);
});
