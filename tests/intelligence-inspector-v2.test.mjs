import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inspectorPath = new URL(
  "../src/components/aicis/inspector/IntelligenceInspector.tsx",
  import.meta.url,
);

test("Inspector renders workspace-supplied intelligence attributes", async () => {
  const source = await readFile(inspectorPath, "utf8");

  assert.match(source, /selectedEntity\.metadata/);
  assert.match(source, /Object\.entries\(selectedEntity\.metadata\)/);
  assert.match(source, /Supplied attributes/);
  assert.match(source, /metadataLabel\(key\)/);
  assert.match(source, /metadataValue\(value\)/);
});

test("Inspector preserves unavailable values and does not infer units", async () => {
  const source = await readFile(inspectorPath, "utf8");

  assert.match(source, /if \(value === null\) return "Unavailable"/);
  assert.match(source, /does not infer missing units/);
  assert.match(source, /replace unavailable values/);
});

test("Desktop inspector preserves more workspace width on tablet breakpoints", async () => {
  const source = await readFile(inspectorPath, "utf8");

  assert.match(source, /w-\[300px\]/);
  assert.match(source, /lg:w-\[320px\]/);
  assert.match(source, /xl:w-\[360px\]/);
});


test("Inspector disables context tabs until a workspace supplies their data", async () => {
  const source = await readFile(inspectorPath, "utf8");

  assert.match(source, /const tabAvailable =/);
  assert.match(source, /tab === "overview" \|\| tab === "ask"/);
  assert.match(source, /tab === "evidence"/);
  assert.match(source, /selectedEntity\?\.provenance\?\.length/);
  assert.match(source, /disabled=\{!available\}/);
  assert.match(source, /context has not been supplied by the current workspace/);
});
