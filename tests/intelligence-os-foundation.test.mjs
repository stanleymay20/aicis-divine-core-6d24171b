import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutPath = new URL("../src/components/aicis/AICISLayout.tsx", import.meta.url);
const shellPath = new URL("../src/components/aicis/shell/AICISAppShell.tsx", import.meta.url);
const contextPath = new URL("../src/contexts/IntelligenceOSContext.tsx", import.meta.url);
const topBarPath = new URL("../src/components/aicis/AICISTopBar.tsx", import.meta.url);
const sidebarPath = new URL("../src/components/aicis/AICISSidebar.tsx", import.meta.url);
const inspectorPath = new URL("../src/components/aicis/inspector/IntelligenceInspector.tsx", import.meta.url);

test("AICIS authenticated shell is wrapped in the Intelligence OS provider", async () => {
  const source = await readFile(layoutPath, "utf8");
  assert.match(source, /<IntelligenceOSProvider>/);
  assert.match(source, /<AICISAppShell>/);
});

test("shell contains command palette, inspector, status, and existing trust footer", async () => {
  const source = await readFile(shellPath, "utf8");
  assert.match(source, /<AICISCommandPalette \/>/);
  assert.match(source, /<IntelligenceInspector \/>/);
  assert.match(source, /<SystemStatusBar \/>/);
  assert.match(source, /<TrustFooter \/>/);
});

test("entity selection is URL-addressable and never requires a database schema change", async () => {
  const source = await readFile(contextPath, "utf8");
  assert.match(source, /useSearchParams/);
  assert.match(source, /const ENTITY_PARAM = "entity"/);
  assert.match(source, /next\.set\(ENTITY_PARAM, key\)/);
  assert.match(source, /aicis:select-entity/);
});

test("top bar exposes contextual Ask and command palette entry points", async () => {
  const source = await readFile(topBarPath, "utf8");
  assert.match(source, /onClick=\{openAsk\}/);
  assert.match(source, /setCommandPaletteOpen\(true\)/);
  assert.match(source, /⌘K/);
});

test("primary navigation remains intentionally consolidated into eight workspaces", async () => {
  const source = await readFile(sidebarPath, "utf8");
  for (const label of ["World", "Brief", "Analysis", "Forecasts", "Opportunities", "Decisions", "Data & Trust", "System"]) {
    assert.match(source, new RegExp('label: "' + label.replace("&", "\\&") + '"'));
  }
});

test("inspector carries explicit unknown and unavailable states instead of inventing data", async () => {
  const source = await readFile(inspectorPath, "utf8");
  assert.match(source, /No provenance summary has been supplied/);
  assert.match(source, /Related forecasts will appear here/);
  assert.match(source, /select an entity first for stronger context|No entity selected/);
});
