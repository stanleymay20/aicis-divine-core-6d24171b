import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspacesPath = new URL("../src/lib/aicis-workspaces.ts", import.meta.url);
const sidebarPath = new URL("../src/components/aicis/AICISSidebar.tsx", import.meta.url);
const topBarPath = new URL("../src/components/aicis/AICISTopBar.tsx", import.meta.url);
const palettePath = new URL("../src/components/aicis/command/AICISCommandPalette.tsx", import.meta.url);
const pulsePath = new URL("../src/pages/SystemPulse.tsx", import.meta.url);

test("AICIS has exactly eight canonical primary workspaces", async () => {
  const source = await readFile(workspacesPath, "utf8");
  const ids = [
    "world",
    "brief",
    "analysis",
    "forecasts",
    "opportunities",
    "decisions",
    "data-trust",
    "system",
  ];

  for (const id of ids) {
    assert.match(source, new RegExp(`id: "${id}"`));
  }

  assert.equal(
    [...source.matchAll(/\bid: "(?:world|brief|analysis|forecasts|opportunities|decisions|data-trust|system)"/g)].length,
    8,
  );
});

test("Workspace switching preserves selected entity and Ask question only", async () => {
  const source = await readFile(workspacesPath, "utf8");

  assert.match(source, /for \(const key of \["entity", "question"\]\)/);
  assert.doesNotMatch(source, /for \(const key of \["entity", "question", "role"/);
});

test("Sidebar is driven by the canonical workspace map and does not hide System", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.match(source, /AICIS_WORKSPACES/);
  assert.match(source, /persistedWorkspaceSearch/);
  assert.doesNotMatch(source, /const primaryItems/);
  assert.doesNotMatch(source, /minRole/);
});

test("Command palette exposes the same canonical workspaces with shared context", async () => {
  const source = await readFile(palettePath, "utf8");

  assert.match(source, /AICIS_WORKSPACES\.map/);
  assert.match(source, /persistedWorkspaceSearch/);
  assert.doesNotMatch(source, /baseWorkspaces/);
  assert.doesNotMatch(source, /useUserRoles/);
});

test("Top bar resolves titles from the canonical workspace map", async () => {
  const source = await readFile(topBarPath, "utf8");

  assert.match(source, /workspaceForPath\(location\.pathname\)/);
  assert.match(source, /persistedWorkspaceSearch\(location\.search\)/);
  assert.match(source, /System · Data Pipeline/);
  assert.doesNotMatch(source, /PAGE_TITLES/);
  assert.doesNotMatch(source, /titleFor/);
});

test("System Pulse is read-only for non-operators", async () => {
  const source = await readFile(pulsePath, "utf8");

  assert.match(source, /useUserRoles/);
  assert.match(source, /if \(!isOperator\) return/);
  assert.match(source, /isOperator \? \(/);
  assert.match(source, /Read-only system health/);
});


test("Workspace roots do not show a misleading back-to-World action", async () => {
  const source = await readFile(topBarPath, "utf8");

  assert.match(source, /pathname\.startsWith\("\/deepdive\/"\)/);
  assert.match(source, /pathname\.startsWith\("\/local-events\/"\)/);
  assert.match(source, /pathname\.startsWith\("\/atlas\/"\)/);
  assert.match(source, /return null;/);
  assert.doesNotMatch(source, /if \(pathname === "\/world"\) return null;[\s\S]*return "\/world";/);
  assert.match(source, /navigateWithContext\("\/world"\)/);
});
