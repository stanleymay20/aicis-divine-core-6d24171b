import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const graphPath = new URL("../src/pages/PlanetaryGraphExplorer.tsx", import.meta.url);
const resolutionPath = new URL("../src/pages/ResolutionExplorer.tsx", import.meta.url);

test("Planetary graph participates in the shared Analysis workspace", async () => {
  const source = await readFile(graphPath, "utf8");

  assert.match(source, /AnalysisWorkspaceNav/);
  assert.match(source, /<AnalysisWorkspaceNav \/>/);
  assert.match(source, /path="\/planetary-graph"/);
});

test("Geographic resolution participates in the shared Analysis workspace", async () => {
  const source = await readFile(resolutionPath, "utf8");

  assert.match(source, /AnalysisWorkspaceNav/);
  assert.match(source, /<AnalysisWorkspaceNav \/>/);
  assert.match(source, /Country & Region Risk Map/);
});
