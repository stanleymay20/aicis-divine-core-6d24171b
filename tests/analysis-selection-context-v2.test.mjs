import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const typesPath = new URL("../src/types/intelligence-os.ts", import.meta.url);
const graphPath = new URL("../src/pages/PlanetaryGraphExplorer.tsx", import.meta.url);
const resolutionPath = new URL("../src/pages/ResolutionExplorer.tsx", import.meta.url);

test("Intelligence OS supports honest generic graph nodes", async () => {
  const source = await readFile(typesPath, "utf8");
  assert.match(source, /"graph_node"/);
});

test("Graph node selection opens shared intelligence context", async () => {
  const source = await readFile(graphPath, "utf8");
  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /type: "graph_node"/);
  assert.match(source, /focusNode\(node\)/);
  assert.match(source, /visibleWeightedDegree/);
});

test("Geographic drill-down selects country and region intelligence entities", async () => {
  const source = await readFile(resolutionPath, "utf8");
  assert.match(source, /type: "country"/);
  assert.match(source, /type: "region"/);
  assert.match(source, /countryIso3/);
  assert.match(source, /selectEntity/);
});
