import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelPath = new URL("../src/components/aicis/intelligence/AskAICISPanel.tsx", import.meta.url);

test("Ask AICIS preloads the active URL-backed investigation question", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /useLocation/);
  assert.match(source, /new URLSearchParams\(location\.search\)/);
  assert.match(source, /get\("question"\)/);
  assert.match(source, /useState\(activeQuestion\)/);
  assert.match(source, /setQuestion\(activeQuestion\)/);
});

test("Ask AICIS preserves selected entity context when opening full research", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /params\.set\("question", trimmed\)/);
  assert.match(source, /params\.set\("entity"/);
  assert.match(source, /\/intelligence-engine\?/);
});

test("Ask AICIS explains when the investigation question is preloaded", async () => {
  const source = await readFile(panelPath, "utf8");

  assert.match(source, /active investigation question is preloaded/);
});
