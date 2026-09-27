import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worldPath = new URL("../src/pages/WorldWorkspace.tsx", import.meta.url);
const mapPath = new URL("../src/components/command-center/GlobalMap.tsx", import.meta.url);
const streamPath = new URL("../src/components/aicis/RealtimeOperationsStream.tsx", import.meta.url);

test("World uses the shared Intelligence OS instead of a duplicate local inspector", async () => {
  const source = await readFile(worldPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.doesNotMatch(source, /Context inspector/);
  assert.doesNotMatch(source, /inspectorTabs/);
});

test("World maps countries, incidents, and stream items to typed intelligence entities", async () => {
  const source = await readFile(worldPath, "utf8");

  assert.match(source, /type: "country"/);
  assert.match(source, /type: "event"/);
  assert.match(source, /type: "signal"/);
  assert.match(source, /onCountrySelect=\{selectCountry\}/);
  assert.match(source, /onIncidentSelect=\{selectIncident\}/);
  assert.match(source, /onEventSelect=\{selectStreamEvent\}/);
});

test("GlobalMap distinguishes incident selection from country selection", async () => {
  const source = await readFile(mapPath, "utf8");

  assert.match(source, /onIncidentSelect\?:/);
  assert.match(source, /if \(onIncidentSelect\)/);
  assert.match(source, /onIncidentSelect\(incident\)/);
});

test("Realtime stream supports compact selectable events without requiring selection", async () => {
  const source = await readFile(streamPath, "utf8");

  assert.match(source, /compact = false/);
  assert.match(source, /onEventSelect\?:/);
  assert.match(source, /onClick=\{\(\) => onEventSelect\?\.\(event\)\}/);
  assert.match(source, /disabled=\{!onEventSelect\}/);
});


test("World layer state is shareable and deep-linked countries rehydrate the map", async () => {
  const source = await readFile(worldPath, "utf8");

  assert.match(source, /useSearchParams/);
  assert.match(source, /next\.set\("layer", layer\)/);
  assert.match(source, /selectedEntity\?\.type !== "country"/);
  assert.match(source, /ALL_COUNTRIES\.find/);
  assert.match(source, /mapRef\.current\?\.flyToCountry\(country\)/);
});

test("GlobalMap supports controlled layer state and a map-ready callback", async () => {
  const source = await readFile(mapPath, "utf8");

  assert.match(source, /activeLayer\?: string/);
  assert.match(source, /onActiveLayerChange\?:/);
  assert.match(source, /controlledActiveLayer \?\? internalActiveLayer/);
  assert.match(source, /onReadyRef\.current\?\.\(\)/);
});
